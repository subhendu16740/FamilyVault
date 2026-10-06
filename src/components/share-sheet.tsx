// Share by link (migration 036): one document, for someone outside the
// family, for 1, 7 or 30 days. The link is shown once, when it is made — its
// secret is never stored — and the family sees every live link below, with
// how often it was opened. Whoever made a link, or an admin, can turn it off.
//
// Web only: a link opens the web app's /s page, and only the web app knows
// its own address.

import { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Modal, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useAuth } from '../lib/auth';
import { useFamily } from '../lib/family-context';
import {
  createShareLink, fetchShareLinks, revokeShareLink, shareLinkUrl, type ShareDays, type ShareLink,
} from '../lib/api';
import { longDate } from '../lib/dates';
import { Field, Muted, PrimaryButton, SecondaryButton, Status } from './settings-ui';
import { color, radius, size, space, type } from '../constants/design';

const DAYS: { days: ShareDays; label: string }[] = [
  { days: 1, label: '1 day' },
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
];

interface Props {
  visible: boolean;
  onClose: () => void;
  familyId: string;
  documentId: string;
  fileName: string;
}

export function ShareSheet({ visible, onClose, familyId, documentId, fileName }: Props) {
  const { user } = useAuth();
  const { members, membership } = useFamily();
  const isAdmin = membership?.role === 'admin';
  const [links, setLinks] = useState<ShareLink[] | 'unavailable' | null>(null);
  const [days, setDays] = useState<ShareDays>(7);
  const [note, setNote] = useState('');
  const [making, setMaking] = useState(false);
  const [made, setMade] = useState<{ url: string; expiresAt: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const load = useCallback(() => {
    fetchShareLinks(familyId, documentId)
      .then(setLinks)
      .catch((err) => { setLinks([]); setProblem(err?.message ?? 'Could not load the links.'); });
  }, [familyId, documentId]);

  useEffect(() => {
    if (!visible) return;
    setMade(null);
    setCopied(false);
    setProblem(null);
    setNote('');
    setDays(7);
    setLinks(null);
    load();
  }, [visible, load]);

  const nameOf = (userId: string) => {
    if (userId === user?.id) return 'you';
    const m = members.find((x) => x.user_id === userId);
    return m?.alias || m?.users?.display_name?.split(' ')[0] || 'someone in the family';
  };

  const make = async () => {
    setMaking(true);
    setProblem(null);
    try {
      const outcome = await createShareLink(familyId, documentId, days, note);
      if (outcome.status === 'made') {
        setMade({ url: shareLinkUrl(window.location.origin, outcome.token), expiresAt: outcome.link.expiresAt });
        setCopied(false);
        setLinks((prev) => (Array.isArray(prev) ? [outcome.link, ...prev] : [outcome.link]));
      } else if (outcome.status === 'refused') {
        setProblem(outcome.message);
      } else {
        setProblem('Share links are not switched on yet.');
      }
    } catch (err: any) {
      setProblem(err?.message || 'Could not make a link. Please try again.');
    } finally {
      setMaking(false);
    }
  };

  const copy = async () => {
    if (!made) return;
    try {
      await navigator.clipboard.writeText(made.url);
      setCopied(true);
    } catch {
      setProblem('Could not copy. Select the link and copy it yourself.');
    }
  };

  const shareOut = async () => {
    if (!made) return;
    try {
      await navigator.share({ title: fileName, text: `${fileName}, from AskLocker`, url: made.url });
    } catch {
      // Closed without sharing: nothing to say.
    }
  };

  const turnOff = async (id: string) => {
    setProblem(null);
    try {
      await revokeShareLink(id);
      setLinks((prev) => (Array.isArray(prev) ? prev.filter((l) => l.id !== id) : prev));
    } catch (err: any) {
      setProblem(err?.message || 'Could not turn the link off. Please try again.');
    }
  };

  const canShareOut = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.handle} />
        <View style={styles.header}>
          <Text style={styles.title}>Share by link</Text>
          <TouchableOpacity onPress={onClose} style={styles.close} accessibilityRole="button" accessibilityLabel="Close">
            <Feather name="x" size={size.icon} color={color.textMuted} />
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          {links === 'unavailable' ? (
            <Muted>Share links are not switched on yet.</Muted>
          ) : (
            <>
              <Text style={styles.intro}>
                Anyone with the link can open this document — no account needed — until it expires. You can turn it
                off at any time.
              </Text>

              {made ? (
                <View style={styles.made}>
                  <Text style={styles.linkBox} selectable numberOfLines={2}>{made.url}</Text>
                  <PrimaryButton label={copied ? 'Copied' : 'Copy link'} icon={copied ? 'check' : 'copy'} onPress={copy} />
                  {canShareOut && <SecondaryButton label="Send it…" icon="share-2" onPress={shareOut} />}
                  <Muted>It works until {longDate(new Date(made.expiresAt))}. This is the only time it is shown.</Muted>
                </View>
              ) : (
                <>
                  <Field
                    label="Who is it for? (optional)"
                    placeholder="e.g. CA Sharma"
                    value={note}
                    onChangeText={setNote}
                    maxLength={80}
                  />
                  <View style={styles.field}>
                    <Text style={styles.label}>How long?</Text>
                    <View style={styles.chips} accessibilityRole="radiogroup">
                      {DAYS.map((d) => {
                        const on = d.days === days;
                        return (
                          <TouchableOpacity
                            key={d.days}
                            style={[styles.chip, on && styles.chipOn]}
                            onPress={() => setDays(d.days)}
                            accessibilityRole="radio"
                            aria-checked={on}
                          >
                            <Text style={[styles.chipText, on && styles.chipTextOn]}>{d.label}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </View>
                  <PrimaryButton label="Make a link" icon="link" onPress={make} busy={making} disabled={making} />
                </>
              )}

              {!!problem && <Status kind="error">{problem}</Status>}

              <Text style={styles.section}>Links for this document</Text>
              {links === null ? (
                <ActivityIndicator color={color.primary} />
              ) : links.length === 0 ? (
                <Muted>None are working now.</Muted>
              ) : (
                links.map((l) => (
                  <View key={l.id} style={styles.row}>
                    <View style={styles.rowText}>
                      <Text style={styles.rowTitle} numberOfLines={1}>
                        {l.note ? `For ${l.note}` : 'A link'} · until {longDate(new Date(l.expiresAt))}
                      </Text>
                      <Text style={styles.rowSub}>
                        {l.openCount === 0 ? 'Not opened yet' : l.openCount === 1 ? 'Opened once' : `Opened ${l.openCount} times`}
                        {' · made by '}{nameOf(l.createdBy)}
                      </Text>
                    </View>
                    {(isAdmin || l.createdBy === user?.id) && (
                      <TouchableOpacity style={styles.off} onPress={() => turnOff(l.id)} accessibilityRole="button" accessibilityLabel="Turn off this link">
                        <Text style={styles.offText}>Turn off</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                ))
              )}
            </>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: {
    backgroundColor: color.surface, borderTopLeftRadius: radius.card, borderTopRightRadius: radius.card,
    maxHeight: '88%', paddingBottom: space.lg,
  },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: color.border, marginTop: space.sm },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.lg, paddingTop: space.sm },
  title: { ...type.title, color: color.text },
  close: { width: size.control, height: size.control, alignItems: 'center', justifyContent: 'center' },
  body: { paddingHorizontal: space.lg, paddingBottom: space.lg, gap: space.md },
  intro: type.caption,
  made: { gap: space.sm },
  linkBox: {
    ...type.caption, color: color.text, padding: space.md, borderRadius: radius.control,
    borderWidth: 1, borderColor: color.border, backgroundColor: color.background,
  },
  field: { gap: space.sm },
  label: { ...type.label, color: color.text },
  chips: { flexDirection: 'row', gap: space.sm },
  chip: {
    flex: 1, minHeight: 40, borderRadius: radius.control, borderWidth: 1, borderColor: color.border,
    alignItems: 'center', justifyContent: 'center',
  },
  chipOn: { borderColor: color.primary, backgroundColor: color.tint },
  chipText: { ...type.label, color: color.textMuted },
  chipTextOn: { color: color.primary, fontWeight: '600' },
  section: { ...type.overline, marginTop: space.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: size.row },
  rowText: { flex: 1, minWidth: 0, gap: 2 },
  rowTitle: type.label,
  rowSub: type.caption,
  off: { minHeight: size.control, paddingHorizontal: space.md, alignItems: 'center', justifyContent: 'center' },
  offText: { ...type.label, color: color.danger, fontWeight: '600' },
});
