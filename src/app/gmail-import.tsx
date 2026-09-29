// ─── Import from Gmail ───────────────────────────────────────────
//
// Connect your own Gmail → FamilyVault lists the attachments that look like
// documents → tick the ones to keep → each is imported like an upload.
// Nothing is imported without a tick, and only the person whose mailbox it
// is sees what was found.
//
// Google sends the browser back here as /gmail-import?gmail_state=…&gmail_code=…
// (through the gmail-callback function); the code is traded for a token by
// an authenticated call and the address bar is cleaned at once.
//
// Web only for now: the phone app would need an auth session and a deep
// link (familyvault://), which needs a native build to verify.
// ────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet, ActivityIndicator, Platform, Modal, Pressable,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../lib/auth';
import { useFamily } from '../lib/family-context';
import {
  fetchCategories, gmailDisconnect, gmailFinishConnect, gmailImportItem, gmailListItems, gmailScanBatch,
  gmailStartConnect, gmailStatus, GmailApiError, type GmailImportResult, type GmailItem, type GmailStatus,
} from '../lib/api';
import type { Database } from '../lib/database.types';
import { ScreenHeader } from '../components/screen-header';
import { color, radius, shadow, size, space, type } from '../constants/design';

type DocumentCategory = Database['public']['Tables']['document_categories']['Row'];
type Notice = { tone: 'error' | 'info' | 'success'; text: string };

const GROUPS = [
  { key: 'suggested', title: 'Suggested', hint: 'These look like documents worth keeping.' },
  { key: 'maybe', title: 'Maybe', hint: 'Could be documents. Worth a look.' },
  { key: 'unlikely', title: 'Probably not', hint: 'Marketing, pictures inside emails, very large files.' },
] as const;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const importable = (item: GmailItem) => item.status === 'found' || item.status === 'failed';

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function formatDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

/** "HDFC Bank <alerts@hdfcbank.net>" → "HDFC Bank". */
function senderName(from: string | null): string {
  if (!from) return 'Unknown sender';
  const name = from.replace(/<[^>]*>/, '').replace(/"/g, '').trim();
  return name || from.replace(/[<>]/g, '');
}

function readable(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export default function GmailImportScreen() {
  const { user } = useAuth();
  const { currentFamily, members } = useFamily();
  const params = useLocalSearchParams<{ gmail_state?: string; gmail_code?: string; gmail_error?: string }>();

  const [status, setStatus] = useState<GmailStatus | null>(null);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  const [items, setItems] = useState<GmailItem[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [categories, setCategories] = useState<DocumentCategory[]>([]);
  const [categoryFor, setCategoryFor] = useState<Record<string, string>>({});
  const [owner, setOwner] = useState('');
  const [showUnlikely, setShowUnlikely] = useState(false);
  const [pickerFor, setPickerFor] = useState<string | null>(null);

  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState<{ scanned: number; found: number } | null>(null);
  const [importing, setImporting] = useState<{ done: number; total: number } | null>(null);

  const mounted = useRef(true);
  const stopRequested = useRef(false);
  const handledReturn = useRef(false);
  // Suggested items are ticked the first time they appear, never again: a
  // reload must not re-tick what the person unticked.
  const seen = useRef(new Set<string>());

  useEffect(() => () => { mounted.current = false; stopRequested.current = true; }, []);

  useEffect(() => {
    fetchCategories().then(setCategories).catch(() => {});
  }, []);

  // The documents belong to the person importing unless they say otherwise.
  useEffect(() => {
    if (owner || !members.length) return;
    setOwner((members.find((m) => m.user_id === user?.id) ?? members[0]).id);
  }, [members, user?.id]);

  const categoryIdByName = useMemo(() => new Map(categories.map((c) => [c.name, c.id])), [categories]);
  const categoryName = useMemo(() => new Map(categories.map((c) => [c.id, c.name])), [categories]);
  const otherCategoryId = categoryIdByName.get('Other') ?? '';

  const loadItems = useCallback(async () => {
    const list = await gmailListItems();
    if (!mounted.current) return;
    setItems(list);
    setSelected((prev) => {
      const next = new Set(prev);
      for (const item of list) {
        if (seen.current.has(item.id)) continue;
        seen.current.add(item.id);
        if (item.suggestion === 'suggested' && importable(item)) next.add(item.id);
      }
      for (const id of next) {
        const item = list.find((i) => i.id === id);
        if (!item || !importable(item)) next.delete(id);
      }
      return next;
    });
  }, []);

  const loadStatus = useCallback(async () => {
    try {
      const s = await gmailStatus();
      if (!mounted.current) return;
      setStatus(s);
      // Each project needs its own Google client and key (PROD before its own
      // setup, say): say so up front, not after a press of "Connect".
      if (!s.configured) {
        setUnavailable(`Gmail import is not set up on this server yet${s.missing?.length ? ` (missing ${s.missing.join(', ')})` : ''}.`);
        return;
      }
      setUnavailable(null);
      if (s.connected) await loadItems();
    } catch (err) {
      if (!mounted.current) return;
      if (err instanceof GmailApiError && ['unavailable', 'needs_migration', 'not_configured'].includes(err.status)) {
        setUnavailable(err.message);
      } else {
        setNotice({ tone: 'error', text: readable(err) });
      }
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [loadItems]);

  // First load — or the browser is back from Google.
  useEffect(() => {
    if (handledReturn.current) return;
    handledReturn.current = true;
    const { gmail_state: state, gmail_code: code, gmail_error: googleError } = params;
    if (!state) {
      loadStatus();
      return;
    }
    (async () => {
      if (googleError || !code) {
        setNotice({
          tone: 'info',
          text: googleError === 'access_denied'
            ? 'Gmail was not connected: permission was not given.'
            : 'Gmail was not connected. Please try again.',
        });
      } else {
        try {
          const { email } = await gmailFinishConnect(state, code);
          setNotice({ tone: 'success', text: `Connected to ${email}. Press "Find documents" to look through it.` });
        } catch (err) {
          setNotice({ tone: 'error', text: readable(err) });
        }
      }
      // The code is spent either way; take it out of the address bar.
      router.replace('/gmail-import' as any);
      await loadStatus();
    })();
  }, []);

  // ─── Connect / disconnect ───────────────────────────────────────

  const connect = async () => {
    if (Platform.OS !== 'web') {
      setNotice({ tone: 'info', text: 'Open FamilyVault in a web browser to connect Gmail. The phone app cannot do it yet.' });
      return;
    }
    setConnecting(true);
    setNotice(null);
    try {
      const url = await gmailStartConnect(window.location.origin);
      window.location.assign(url);
    } catch (err) {
      setConnecting(false);
      if (err instanceof GmailApiError && err.status === 'origin_not_allowed') {
        setNotice({
          tone: 'error',
          text: `Gmail can't return to this address (${err.origin ?? window.location.origin}) yet. Add it to the GMAIL_RETURN_ORIGINS secret in Supabase, or open FamilyVault from an address that is listed there.`,
        });
      } else if (err instanceof GmailApiError && ['not_configured', 'needs_migration', 'unavailable'].includes(err.status)) {
        setUnavailable(err.message);
      } else {
        setNotice({ tone: 'error', text: readable(err) });
      }
    }
  };

  const disconnect = async () => {
    setConfirmDisconnect(false);
    try {
      await gmailDisconnect();
      seen.current.clear();
      setItems([]);
      setSelected(new Set());
      setProgress(null);
      setNotice({ tone: 'info', text: 'Gmail is disconnected. Documents you imported stay in your vault.' });
      await loadStatus();
    } catch (err) {
      setNotice({ tone: 'error', text: readable(err) });
    }
  };

  // ─── Scan ───────────────────────────────────────────────────────

  const scan = async () => {
    // "Check for new emails" after a finished scan starts from the newest again.
    let restart = !!status?.scan?.finished_at;
    stopRequested.current = false;
    setScanning(true);
    setNotice(null);
    let batches = 0;
    try {
      while (mounted.current && !stopRequested.current) {
        try {
          const p = await gmailScanBatch(restart);
          restart = false;
          batches++;
          if (!mounted.current) return;
          setProgress({ scanned: p.messages_scanned, found: p.found });
          if (p.done || batches % 4 === 0) await loadItems();
          if (p.done) break;
        } catch (err) {
          if (err instanceof GmailApiError && err.status === 'rate_limited') {
            await sleep((err.retryAfter ?? 30) * 1000);
            continue;
          }
          if (err instanceof GmailApiError && err.status === 'busy') {
            await sleep(3000);
            continue;
          }
          throw err;
        }
      }
    } catch (err) {
      setNotice({ tone: 'error', text: readable(err) });
    } finally {
      if (mounted.current) {
        setScanning(false);
        await loadStatus();
      }
    }
  };

  // ─── Import ─────────────────────────────────────────────────────

  const queue = items.filter((item) => selected.has(item.id) && importable(item));
  const queueBytes = queue.reduce((sum, item) => sum + item.size_bytes, 0);

  const importSelected = async () => {
    if (!currentFamily || !queue.length) return;
    stopRequested.current = false;
    setNotice(null);
    setImporting({ done: 0, total: queue.length });
    let imported = 0;
    let duplicates = 0;
    let failed = 0;
    let unreadable = 0;
    // Gmail may ask us to slow down; wait as asked, twice at most.
    const importOne = async (item: GmailItem, categoryId: string): Promise<GmailImportResult> => {
      for (let attempt = 0; ; attempt++) {
        try {
          return await gmailImportItem(item.id, currentFamily.id, { categoryId: categoryId || undefined, memberId: owner || undefined });
        } catch (err) {
          if (!(err instanceof GmailApiError && err.status === 'rate_limited' && attempt < 2)) throw err;
          await sleep((err.retryAfter ?? 30) * 1000);
        }
      }
    };
    try {
      for (const [index, item] of queue.entries()) {
        if (!mounted.current || stopRequested.current) break;
        const categoryId = categoryFor[item.id] ?? categoryIdByName.get(item.category_guess ?? '') ?? otherCategoryId;
        const result = await importOne(item, categoryId);
        if (result.status === 'imported') {
          imported++;
          if (result.unreadable) unreadable++;
        } else if (result.status === 'duplicate') {
          duplicates++;
        } else {
          failed++;
        }
        setItems((prev) => prev.map((i) => (i.id !== item.id ? i : {
          ...i,
          status: result.status,
          document_id: result.status === 'failed' ? i.document_id : result.documentId,
          error: result.status === 'failed' ? result.error : result.status === 'imported' ? result.unreadable ?? null : null,
        })));
        setSelected((prev) => {
          const next = new Set(prev);
          if (result.status !== 'failed') next.delete(item.id);
          return next;
        });
        setImporting({ done: index + 1, total: queue.length });
      }
      const parts = [
        imported ? `Imported ${imported} document${imported === 1 ? '' : 's'}` : '',
        duplicates ? `${duplicates} ${duplicates === 1 ? 'was' : 'were'} already in your vault` : '',
        unreadable ? `${unreadable} saved without readable text` : '',
        failed ? `${failed} could not be imported` : '',
      ].filter(Boolean);
      setNotice({ tone: failed ? 'info' : 'success', text: `${parts.join('. ') || 'Nothing was imported'}.` });
    } catch (err) {
      setNotice({ tone: 'error', text: readable(err) });
    } finally {
      if (mounted.current) {
        setImporting(null);
        await loadStatus();
      }
    }
  };

  // ─── Render ─────────────────────────────────────────────────────

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const busy = scanning || !!importing;

  const renderItem = (item: GmailItem) => {
    const ticked = selected.has(item.id);
    const canTick = importable(item) && !busy;
    const categoryId = categoryFor[item.id] ?? categoryIdByName.get(item.category_guess ?? '') ?? otherCategoryId;
    return (
      <View key={item.id} style={styles.itemRow}>
        <TouchableOpacity
          onPress={() => canTick && toggle(item.id)}
          disabled={!canTick}
          style={styles.checkbox}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: ticked, disabled: !canTick }}
        >
          {item.status === 'imported' || item.status === 'duplicate' ? (
            <Feather name="check-circle" size={22} color="#16A34A" />
          ) : item.status === 'importing' ? (
            <ActivityIndicator size="small" color="#2A3D66" />
          ) : (
            <Feather name={ticked ? 'check-square' : 'square'} size={22} color={ticked ? '#2A3D66' : '#9CA3AF'} />
          )}
        </TouchableOpacity>
        <View style={styles.itemBody}>
          <View style={styles.itemTitleRow}>
            <Feather name={item.mime_type === 'application/pdf' ? 'file-text' : 'image'} size={14} color="#6B7280" />
            <Text style={styles.itemName} numberOfLines={1}>{item.file_name}</Text>
          </View>
          <Text style={styles.itemMeta} numberOfLines={1}>
            {senderName(item.sender)} · {formatDate(item.sent_at)} · {formatSize(item.size_bytes)}
          </Text>
          {!!item.subject && <Text style={styles.itemSubject} numberOfLines={1}>{item.subject}</Text>}
          {item.status === 'imported' || item.status === 'duplicate' ? (
            <View style={styles.itemDoneRow}>
              <Text style={styles.itemDoneText}>
                {item.status === 'duplicate' ? 'Already in your vault' : item.error ? `Imported. ${item.error}` : 'Imported'}
              </Text>
              {!!item.document_id && (
                <TouchableOpacity onPress={() => router.push(`/document/${item.document_id}` as any)}>
                  <Text style={styles.linkText}>View</Text>
                </TouchableOpacity>
              )}
            </View>
          ) : item.status === 'failed' ? (
            <Text style={styles.itemError}>{item.error ?? 'Could not be imported.'} Tick it to try again.</Text>
          ) : (
            <View style={styles.itemFooter}>
              {!!item.reason && <Text style={styles.itemReason} numberOfLines={1}>{item.reason}</Text>}
              <TouchableOpacity style={styles.categoryChip} onPress={() => !busy && setPickerFor(item.id)} disabled={busy}>
                <Text style={styles.categoryChipText} numberOfLines={1}>{categoryName.get(categoryId) ?? 'Category'}</Text>
                <Feather name="chevron-down" size={12} color="#2A3D66" />
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>
    );
  };

  const connected = !!status?.connected && !status.expired;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Import from Gmail" fallback="/upload" />

      <ScrollView style={styles.scroll} contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        {notice && (
          <View style={[styles.notice, noticeTone[notice.tone]]}>
            <Feather
              name={notice.tone === 'error' ? 'alert-circle' : notice.tone === 'success' ? 'check-circle' : 'info'}
              size={16}
              color={notice.tone === 'error' ? '#B91C1C' : notice.tone === 'success' ? '#15803D' : '#2A3D66'}
            />
            <Text style={styles.noticeText}>{notice.text}</Text>
            <TouchableOpacity onPress={() => setNotice(null)} hitSlop={8}>
              <Feather name="x" size={16} color="#6B7280" />
            </TouchableOpacity>
          </View>
        )}

        {loading ? (
          <ActivityIndicator style={{ marginTop: 48 }} color={color.primary} />
        ) : unavailable ? (
          <View style={styles.card}>
            <Feather name="tool" size={28} color="#9CA3AF" />
            <Text style={styles.cardTitle}>Not set up yet</Text>
            <Text style={styles.cardText}>{unavailable}</Text>
          </View>
        ) : !status?.connected || status.expired ? (
          <View style={styles.card}>
            <View style={styles.heroIcon}>
              <Feather name="mail" size={30} color="#2A3D66" />
            </View>
            <Text style={styles.cardTitle}>{status?.expired ? 'Gmail access has expired' : 'Find documents in your email'}</Text>
            <Text style={styles.cardText}>
              {status?.expired
                ? `Google stopped FamilyVault's access to ${status.email}. Connect again to carry on where you left off.`
                : 'FamilyVault looks through your Gmail for attachments that look like documents (policies, statements, tickets, certificates) and shows you a list. Nothing is imported until you choose it.'}
            </Text>
            {!status?.expired && (
              <View style={styles.promises}>
                {[
                  'Looks only at emails with a PDF or photo attached',
                  'Only you see what it finds, not your family',
                  'Disconnect any time: FamilyVault forgets what it found',
                ].map((line) => (
                  <View key={line} style={styles.promiseRow}>
                    <Feather name="check" size={14} color="#16A34A" />
                    <Text style={styles.promiseText}>{line}</Text>
                  </View>
                ))}
              </View>
            )}
            <TouchableOpacity onPress={connect} disabled={connecting} activeOpacity={0.85} style={styles.fullWidth}>
              <LinearGradient colors={['#2A3D66', '#4A6491']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.primaryBtn}>
                {connecting ? <ActivityIndicator color="#FFFFFF" /> : (
                  <Text style={styles.primaryBtnText}>{status?.expired ? 'Reconnect Gmail' : 'Connect Gmail'}</Text>
                )}
              </LinearGradient>
            </TouchableOpacity>
            <Text style={styles.fineprint}>
              Google may warn that this app isn't verified yet. That is expected while FamilyVault's Gmail access is in testing.
            </Text>
          </View>
        ) : (
          <>
            {/* The connected account */}
            <View style={styles.accountRow}>
              <Feather name="mail" size={18} color="#2A3D66" />
              <Text style={styles.accountText} numberOfLines={1}>{status.email}</Text>
              <TouchableOpacity onPress={() => setConfirmDisconnect(true)} disabled={busy}>
                <Text style={[styles.linkText, busy && { opacity: 0.4 }]}>Disconnect</Text>
              </TouchableOpacity>
            </View>

            {/* The scan */}
            <View style={styles.scanCard}>
              {scanning ? (
                <>
                  <View style={styles.scanRow}>
                    <ActivityIndicator size="small" color="#2A3D66" />
                    <Text style={styles.scanText}>
                      Looking through your email… {progress ? `${progress.scanned} checked, ${progress.found} found` : ''}
                    </Text>
                  </View>
                  <TouchableOpacity onPress={() => { stopRequested.current = true; }}>
                    <Text style={styles.linkText}>Pause</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  <Text style={styles.scanText}>
                    {status.scan?.finished_at
                      ? `Checked ${status.scan.messages_scanned} emails with attachments · ${status.found} possible documents`
                      : status.scan?.started_at
                        ? `Paused after ${status.scan.messages_scanned} emails · ${status.found} found so far`
                        : 'Look through your Gmail for documents.'}
                  </Text>
                  <TouchableOpacity onPress={scan} disabled={busy} activeOpacity={0.85}>
                    <LinearGradient colors={['#2A3D66', '#4A6491']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.scanBtn}>
                      <Feather name="search" size={16} color="#FFFFFF" />
                      <Text style={styles.scanBtnText}>
                        {status.scan?.finished_at ? 'Check for new emails' : status.scan?.started_at ? 'Continue' : 'Find documents'}
                      </Text>
                    </LinearGradient>
                  </TouchableOpacity>
                </>
              )}
            </View>

            {items.length > 0 && (
              <>
                <Text style={styles.sectionTitle}>Who do these belong to?</Text>
                <View style={styles.chipsWrap}>
                  {members.map((m) => (
                    <TouchableOpacity
                      key={m.id}
                      onPress={() => !busy && setOwner(m.id)}
                      style={[styles.chip, owner === m.id && styles.chipSelected]}
                    >
                      <Text style={[styles.chipText, owner === m.id && styles.chipTextSelected]}>
                        {m.alias || m.users.display_name}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            )}

            {GROUPS.map((group) => {
              const list = items.filter((i) => i.suggestion === group.key);
              if (!list.length) return null;
              const collapsed = group.key === 'unlikely' && !showUnlikely;
              return (
                <View key={group.key} style={styles.group}>
                  <TouchableOpacity
                    style={styles.groupHeader}
                    disabled={group.key !== 'unlikely'}
                    onPress={() => setShowUnlikely((v) => !v)}
                  >
                    <Text style={styles.groupTitle}>{group.title} ({list.length})</Text>
                    {group.key === 'unlikely' && (
                      <Feather name={collapsed ? 'chevron-down' : 'chevron-up'} size={18} color="#6B7280" />
                    )}
                  </TouchableOpacity>
                  <Text style={styles.groupHint}>{group.hint}</Text>
                  {!collapsed && list.map(renderItem)}
                </View>
              );
            })}

            {!scanning && status.scan?.finished_at && items.length === 0 && (
              <View style={styles.card}>
                <Text style={styles.cardText}>No documents turned up in this mailbox.</Text>
              </View>
            )}
          </>
        )}
      </ScrollView>

      {/* Import button */}
      {connected && (queue.length > 0 || importing) && (
        <View style={styles.footer}>
          <TouchableOpacity onPress={importSelected} disabled={busy || !currentFamily} activeOpacity={0.85}>
            <LinearGradient colors={['#2A3D66', '#4A6491']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={[styles.primaryBtn, busy && { opacity: 0.8 }]}>
              {importing ? (
                <View style={styles.scanRow}>
                  <ActivityIndicator color="#FFFFFF" size="small" />
                  <Text style={styles.primaryBtnText}>Importing {Math.min(importing.done + 1, importing.total)} of {importing.total}…</Text>
                </View>
              ) : (
                <Text style={styles.primaryBtnText}>
                  Import {queue.length} document{queue.length === 1 ? '' : 's'} (≈{formatSize(queueBytes)})
                </Text>
              )}
            </LinearGradient>
          </TouchableOpacity>
          {!!currentFamily && <Text style={styles.footerHint}>Into {currentFamily.name}</Text>}
        </View>
      )}

      {/* Category picker */}
      <Modal visible={!!pickerFor} transparent animationType="fade" onRequestClose={() => setPickerFor(null)}>
        <Pressable style={styles.overlay} onPress={() => setPickerFor(null)}>
          <View style={styles.dialog}>
            <Text style={styles.dialogTitle}>Category</Text>
            <ScrollView style={{ maxHeight: 360, width: '100%' }}>
              {categories.map((cat) => (
                <TouchableOpacity
                  key={cat.id}
                  style={styles.pickerRow}
                  onPress={() => {
                    if (pickerFor) setCategoryFor((prev) => ({ ...prev, [pickerFor]: cat.id }));
                    setPickerFor(null);
                  }}
                >
                  <Text style={styles.pickerText}>{cat.icon ? `${cat.icon}  ` : ''}{cat.name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>

      {/* Disconnect confirmation */}
      <Modal visible={confirmDisconnect} transparent animationType="fade" onRequestClose={() => setConfirmDisconnect(false)}>
        <Pressable style={styles.overlay} onPress={() => setConfirmDisconnect(false)}>
          <View style={styles.dialog}>
            <Text style={styles.dialogTitle}>Disconnect Gmail?</Text>
            <Text style={styles.dialogMsg}>
              FamilyVault will lose access to {status?.email} and forget the list it found. Documents you already imported stay in your vault.
            </Text>
            <View style={styles.dialogBtns}>
              <TouchableOpacity style={styles.dialogBtnOutline} onPress={() => setConfirmDisconnect(false)}>
                <Text style={styles.dialogBtnOutlineText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.dialogBtnFilled} onPress={disconnect}>
                <Text style={styles.dialogBtnFilledText}>Disconnect</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.background },
  scroll: { flex: 1 },
  body: { padding: space.lg, paddingBottom: 140 },
  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: space.md,
    marginBottom: space.lg,
    borderWidth: 1,
  },
  notice_error: { backgroundColor: '#FEF2F2', borderColor: '#FECACA' },
  notice_success: { backgroundColor: '#F0FDF4', borderColor: '#BBF7D0' },
  notice_info: { backgroundColor: color.tint, borderColor: '#BFDBFE' },
  noticeText: { flex: 1, fontSize: 14, lineHeight: 20, color: color.text },
  card: {
    backgroundColor: color.surface,
    borderRadius: radius.card,
    padding: space.xl,
    alignItems: 'center',
    gap: space.md,
    ...shadow.card,
  },
  heroIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#EEF2FA',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitle: { ...type.heading, textAlign: 'center' },
  cardText: { ...type.body, color: '#4B5563', textAlign: 'center' },
  promises: { alignSelf: 'stretch', gap: space.sm, marginVertical: space.xs },
  promiseRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  promiseText: { ...type.caption, flex: 1, color: color.textBody },
  fullWidth: { alignSelf: 'stretch' },
  primaryBtn: {
    borderRadius: radius.control,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: size.control,
    paddingHorizontal: space.lg,
  },
  primaryBtnText: { ...type.button, color: '#FFFFFF' },
  fineprint: { ...type.meta, textAlign: 'center' },
  accountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: color.surface,
    borderRadius: radius.control,
    paddingVertical: 10,
    paddingHorizontal: space.md,
    minHeight: size.row,
    borderWidth: 1,
    borderColor: color.border,
    marginBottom: space.md,
  },
  accountText: { ...type.label, flex: 1 },
  linkText: { ...type.caption, fontWeight: '600', color: color.primary },
  scanCard: {
    backgroundColor: color.surface,
    borderRadius: radius.card,
    padding: space.lg,
    gap: space.md,
    marginBottom: space.xl,
    ...shadow.card,
  },
  scanRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  scanText: { ...type.body, flex: 1 },
  scanBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    borderRadius: radius.control,
    minHeight: size.control,
  },
  scanBtnText: { ...type.button, color: '#FFFFFF' },
  sectionTitle: { ...type.heading, marginBottom: space.md },
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginBottom: space.xl },
  chip: {
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.inputBorder,
    minHeight: 40,
    justifyContent: 'center',
  },
  chipSelected: { backgroundColor: color.primary, borderColor: color.primary },
  chipText: { fontSize: 14, lineHeight: 20, fontWeight: '500', color: color.textBody },
  chipTextSelected: { color: '#FFFFFF' },
  group: { marginBottom: space.xl },
  groupHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  groupTitle: { ...type.heading, color: color.primary },
  groupHint: { ...type.caption, marginTop: 2, marginBottom: 10 },
  itemRow: {
    flexDirection: 'row',
    gap: space.md,
    backgroundColor: color.surface,
    borderRadius: radius.control,
    padding: space.md,
    borderWidth: 1,
    borderColor: color.border,
    marginBottom: space.sm,
  },
  checkbox: { paddingTop: 2, width: 24, alignItems: 'center' },
  itemBody: { flex: 1, minWidth: 0, gap: 3 },
  itemTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  itemName: { ...type.label, flex: 1 },
  itemMeta: { ...type.meta, color: color.textMuted },
  itemSubject: type.meta,
  itemFooter: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.xs },
  itemReason: { ...type.meta, flex: 1, color: color.textMuted, fontStyle: 'italic' },
  categoryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    maxWidth: 170,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.pill,
    backgroundColor: '#EEF2FA',
  },
  categoryChipText: { ...type.meta, fontWeight: '500', color: color.primary, flexShrink: 1 },
  itemDoneRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: space.xs },
  itemDoneText: { ...type.meta, flex: 1, color: '#15803D' },
  itemError: { ...type.meta, color: '#B91C1C', marginTop: space.xs },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    padding: space.lg,
    paddingBottom: space.xl,
    backgroundColor: color.surface,
    borderTopWidth: 1,
    borderTopColor: color.border,
    gap: 6,
  },
  footerHint: { ...type.meta, color: color.textMuted, textAlign: 'center' },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: space.xl,
  },
  dialog: {
    backgroundColor: color.surface,
    borderRadius: radius.card,
    padding: space.xl,
    width: '100%',
    maxWidth: 360,
    alignItems: 'center',
  },
  dialogTitle: { ...type.title, color: color.text, marginBottom: space.sm },
  dialogMsg: { ...type.body, color: color.textMuted, textAlign: 'center', marginBottom: space.xl },
  dialogBtns: { flexDirection: 'row', gap: space.md, width: '100%' },
  dialogBtnOutline: {
    flex: 1,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: color.primary,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: size.control,
  },
  dialogBtnOutlineText: { ...type.button, color: color.primary },
  dialogBtnFilled: {
    flex: 1,
    borderRadius: radius.control,
    backgroundColor: '#B91C1C',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: size.control,
  },
  dialogBtnFilledText: { ...type.button, color: '#FFFFFF' },
  pickerRow: { minHeight: size.control, justifyContent: 'center', paddingHorizontal: space.xs, borderBottomWidth: 1, borderBottomColor: color.divider },
  pickerText: type.body,
});

const noticeTone = { error: styles.notice_error, success: styles.notice_success, info: styles.notice_info };
