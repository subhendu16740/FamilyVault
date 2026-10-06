// The invitations waiting for the signed-in person (migration 037): which
// family asked, and who. Nobody joins a family without saying yes, so this is
// where they say it — on Home and in Manage Family, the two places a person
// looks. Renders nothing when there are none, or before 037.
//
// Accept makes them a member and shows that family: they have just said they
// want it. Decline asks once more first — after a no, only an admin can ask
// again.

import { useCallback, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { useFamily } from '../lib/family-context';
import { acceptInvitation, declineInvitation, fetchMyInvitations, type Invitation } from '../lib/api';
import { color, radius, shadow, size, space, type } from '../constants/design';

export function InvitationCards({ style }: { style?: StyleProp<ViewStyle> }) {
  const { refreshFamilies, switchFamily } = useFamily();
  const [invites, setInvites] = useState<Invitation[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [news, setNews] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const load = useCallback(() => {
    let cancelled = false;
    fetchMyInvitations()
      .then((list) => { if (!cancelled) setInvites(list); })
      .catch(() => { if (!cancelled) setInvites([]); });
    return () => { cancelled = true; };
  }, []);

  useFocusEffect(load);

  const accept = async (invite: Invitation) => {
    setBusy(invite.id);
    setNews(null);
    try {
      const outcome = await acceptInvitation(invite.id);
      if (outcome.status === 'joined') {
        await refreshFamilies();
        switchFamily(outcome.familyId);
        setNews({ kind: 'ok', text: `You joined ${outcome.familyName || invite.familyName}. Its documents are on Home now.` });
      } else {
        setNews({ kind: 'error', text: `The invitation to ${invite.familyName} was withdrawn. Ask a family admin to invite you again.` });
      }
    } catch (err: any) {
      setNews({ kind: 'error', text: err?.message || 'Could not accept. Please try again.' });
    } finally {
      setBusy(null);
      load();
    }
  };

  const decline = async (invite: Invitation) => {
    setBusy(invite.id);
    setNews(null);
    try {
      await declineInvitation(invite.id);
      setConfirming(null);
      setNews({ kind: 'ok', text: `You said no to ${invite.familyName}. They have been told.` });
    } catch (err: any) {
      setNews({ kind: 'error', text: err?.message || 'Could not decline. Please try again.' });
    } finally {
      setBusy(null);
      load();
    }
  };

  if (invites.length === 0 && !news) return null;

  return (
    <View style={[styles.wrap, style]}>
      {!!news && (
        <TouchableOpacity
          style={[styles.news, news.kind === 'error' && styles.newsError]}
          onPress={() => setNews(null)}
          accessibilityRole="button"
          accessibilityLabel={`${news.text} Tap to close.`}
        >
          <Feather name={news.kind === 'ok' ? 'check-circle' : 'alert-circle'} size={16} color={news.kind === 'ok' ? '#15803D' : color.danger} />
          <Text style={[styles.newsText, news.kind === 'error' && styles.newsTextError]}>{news.text}</Text>
        </TouchableOpacity>
      )}
      {invites.map((invite) => {
        const working = busy === invite.id;
        return (
          <View key={invite.id} style={styles.card}>
            <View style={styles.top}>
              <View style={styles.icon}>
                <Feather name="mail" size={16} color={color.primary} />
              </View>
              <View style={styles.text}>
                <Text style={styles.who}>{invite.invitedByName || 'A family admin'} invited you to join</Text>
                <Text style={styles.family}>{invite.familyName}</Text>
                {!!invite.personName && <Text style={styles.sub}>as {invite.personName} in the family tree</Text>}
                <Text style={styles.sub}>
                  You see its documents only if you accept, as {invite.role === 'admin' ? 'an admin' : 'a viewer'}. You can
                  leave at any time.
                </Text>
              </View>
            </View>
            {confirming === invite.id ? (
              <View style={styles.confirm}>
                <Text style={styles.confirmText}>Say no to {invite.familyName}? Only an admin there can ask you again.</Text>
                <View style={styles.buttons}>
                  <TouchableOpacity style={styles.secondary} onPress={() => setConfirming(null)} disabled={working} accessibilityRole="button">
                    <Text style={styles.secondaryText}>Back</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.danger} onPress={() => decline(invite)} disabled={working} accessibilityRole="button" accessibilityLabel={`Say no to ${invite.familyName}`}>
                    {working ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Text style={styles.primaryText}>Say no</Text>}
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <View style={styles.buttons}>
                <TouchableOpacity style={styles.secondary} onPress={() => setConfirming(invite.id)} disabled={working} accessibilityRole="button" accessibilityLabel={`Decline ${invite.familyName}`}>
                  <Text style={styles.secondaryText}>Decline</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.primary} onPress={() => accept(invite)} disabled={working} accessibilityRole="button" accessibilityLabel={`Accept and join ${invite.familyName}`}>
                  {working ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Text style={styles.primaryText}>Accept</Text>}
                </TouchableOpacity>
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.sm },
  card: {
    backgroundColor: color.surface, borderRadius: radius.card, padding: space.lg, gap: space.md,
    borderWidth: 1, borderColor: '#BFDBFE', ...shadow.card,
  },
  top: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start' },
  icon: { width: size.iconBox, height: size.iconBox, borderRadius: 8, backgroundColor: color.tint, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, minWidth: 0, gap: 2 },
  who: type.caption,
  family: type.heading,
  sub: type.caption,
  buttons: { flexDirection: 'row', gap: space.sm },
  primary: { flex: 1, minHeight: size.control, borderRadius: radius.control, backgroundColor: color.primary, alignItems: 'center', justifyContent: 'center' },
  primaryText: { ...type.button, color: '#FFFFFF' },
  secondary: {
    flex: 1, minHeight: size.control, borderRadius: radius.control, borderWidth: 1, borderColor: color.border,
    alignItems: 'center', justifyContent: 'center', backgroundColor: color.surface,
  },
  secondaryText: { ...type.button, color: color.textBody },
  danger: { flex: 1, minHeight: size.control, borderRadius: radius.control, backgroundColor: color.danger, alignItems: 'center', justifyContent: 'center' },
  confirm: { gap: space.sm },
  confirmText: { ...type.body, color: color.text },
  news: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.md,
    borderRadius: radius.control, backgroundColor: '#F0FDF4',
  },
  newsError: { backgroundColor: '#FEF2F2' },
  newsText: { flex: 1, ...type.body, color: '#15803D' },
  newsTextError: { color: color.danger },
});
