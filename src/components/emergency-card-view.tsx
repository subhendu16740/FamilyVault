// What an emergency card says, laid out for reading in a hurry: the blood
// group first and biggest, allergies on red, then conditions, medicines, the
// doctor, health insurance and the people to call, each phone number one tap
// from the dialler. Only what was filled in is shown.
//
// `large` is the full-screen card, held up for a doctor or read by someone
// whose eyes are tired, and the one place text runs larger than the scale in
// src/constants/design.ts. The person page uses the summary instead.

import { View, Text, TouchableOpacity, Linking, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { bloodGroupLabel, bloodGroupSpoken, telHref, type EmergencyCard } from '../lib/emergency';
import { color, radius, size, space, type } from '../constants/design';

const RED = '#B91C1C';
const RED_BG = '#FEF2F2';

export function EmergencyCardDetails({ card, large = false }: { card: EmergencyCard; large?: boolean }) {
  const t = large ? big : small;
  return (
    <View style={styles.wrap}>
      <View style={styles.bloodRow} accessible accessibilityLabel={bloodGroupSpoken(card.bloodGroup)}>
        <Text style={t.label}>Blood group</Text>
        <Text style={[t.blood, !card.bloodGroup && styles.unknown]}>{bloodGroupLabel(card.bloodGroup)}</Text>
      </View>

      {!!card.allergies && (
        <View style={[styles.block, styles.alert]}>
          <View style={styles.alertTitle}>
            <Feather name="alert-triangle" size={large ? 18 : 16} color={RED} />
            <Text style={[t.label, { color: RED }]}>Allergies</Text>
          </View>
          <Text style={[t.value, { color: '#7F1D1D' }]}>{card.allergies}</Text>
        </View>
      )}

      {!!card.conditions && <Item label="Health conditions" value={card.conditions} large={large} />}
      {!!card.medicines && <Item label="Medicines" value={card.medicines} large={large} />}

      {(!!card.doctorName || !!card.doctorPhone) && (
        <View style={styles.block}>
          <Text style={t.label}>Doctor</Text>
          {!!card.doctorName && <Text style={t.value}>{card.doctorName}</Text>}
          {!!card.doctorPhone && <CallButton phone={card.doctorPhone} who={card.doctorName || 'the doctor'} large={large} />}
        </View>
      )}

      {(!!card.insurer || !!card.policyNumber) && (
        <Item
          label="Health insurance"
          value={[card.insurer, card.policyNumber ? `Policy ${card.policyNumber}` : null].filter(Boolean).join('\n')}
          large={large}
          selectable
        />
      )}

      {card.contacts.length > 0 && (
        <View style={styles.block}>
          <Text style={t.label}>People to call</Text>
          {card.contacts.map((c, i) => (
            <View key={`${c.phone}-${i}`} style={styles.contact}>
              <Text style={t.value}>
                {c.name}
                {!!c.relation && <Text style={t.muted}>{`  ·  ${c.relation}`}</Text>}
              </Text>
              <CallButton phone={c.phone} who={c.name} large={large} />
            </View>
          ))}
        </View>
      )}

      {!!card.notes && <Item label="Other notes" value={card.notes} large={large} />}
    </View>
  );
}

function Item({ label, value, large, selectable }: { label: string; value: string; large: boolean; selectable?: boolean }) {
  const t = large ? big : small;
  return (
    <View style={styles.block}>
      <Text style={t.label}>{label}</Text>
      <Text style={t.value} selectable={selectable}>{value}</Text>
    </View>
  );
}

/** One tap to the phone's dialler, with the number written out. */
export function CallButton({ phone, who, large = false }: { phone: string; who: string; large?: boolean }) {
  return (
    <TouchableOpacity
      style={[styles.call, large && styles.callLarge]}
      onPress={() => Linking.openURL(telHref(phone)).catch(() => undefined)}
      activeOpacity={0.8}
      accessibilityRole="link"
      accessibilityLabel={`Call ${who}, ${phone}`}
    >
      <Feather name="phone" size={large ? 18 : 16} color="#FFFFFF" />
      <Text style={[styles.callText, large && styles.callTextLarge]}>{phone}</Text>
    </TouchableOpacity>
  );
}

/** The blood group as a small coloured pill, for lists. */
export function BloodPill({ group }: { group: EmergencyCard['bloodGroup'] }) {
  return (
    <View style={styles.pill} accessible accessibilityLabel={bloodGroupSpoken(group)}>
      <Feather name="droplet" size={12} color={RED} />
      <Text style={styles.pillText}>{bloodGroupLabel(group)}</Text>
    </View>
  );
}

const small = StyleSheet.create({
  label: type.overline,
  value: { ...type.body, color: color.text },
  muted: { ...type.body, color: color.textMuted },
  blood: { fontSize: 28, lineHeight: 34, fontWeight: '700', color: RED },
});

const big = StyleSheet.create({
  label: { ...type.overline, fontSize: 13, lineHeight: 18 },
  value: { fontSize: 19, lineHeight: 27, fontWeight: '500', color: color.text },
  muted: { fontSize: 17, lineHeight: 25, fontWeight: '400', color: color.textMuted },
  blood: { fontSize: 44, lineHeight: 52, fontWeight: '800', color: RED },
});

const styles = StyleSheet.create({
  wrap: { gap: space.md },
  bloodRow: { gap: 2 },
  unknown: { color: color.textMuted, fontWeight: '600' },
  block: { gap: space.xs },
  alert: { backgroundColor: RED_BG, borderRadius: radius.control, padding: space.md, borderWidth: 1, borderColor: '#FECACA' },
  alertTitle: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  contact: { gap: space.xs, paddingVertical: space.xs },
  call: {
    flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: space.sm,
    minHeight: size.control, paddingHorizontal: space.lg, borderRadius: radius.control, backgroundColor: '#15803D',
  },
  callLarge: { minHeight: 52, paddingHorizontal: space.xl },
  callText: { ...type.button, color: '#FFFFFF' },
  callTextLarge: { fontSize: 18, lineHeight: 24 },
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: RED_BG, borderRadius: radius.pill, paddingHorizontal: space.sm, paddingVertical: 2,
  },
  pillText: { ...type.meta, fontWeight: '700', color: RED },
});
