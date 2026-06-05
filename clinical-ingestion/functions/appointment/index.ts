/**
 * clinical-appointment
 *
 * Handles two actions called by Flow 07:
 *
 *  GET_AVAILABILITY (via BedrockAgentInvokeLambdaARN + action:"GET_AVAILABILITY")
 *    → Uses Claude to generate natural-language slot availability message
 *    → Returns: { slotsAvailable, slotsMessage }
 *
 *  Book slot (via AppointmentBookingLambdaARN)
 *    → Writes an appointment record to DynamoDB
 *    → Returns: { bookingSuccess, confirmationMessage }
 */

import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';

const bedrock = new BedrockRuntimeClient({ region: process.env.BEDROCK_REGION || 'us-east-1' });
const dynamo  = DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' }));

const APPOINTMENT_TABLE = process.env.APPOINTMENT_TABLE || 'ClinicalAppointments';
const MODEL_ID = 'anthropic.claude-3-5-sonnet-20241022-v2:0';

// Clinic hours: Sat-Thu 8am-8pm, every 30 min slots
function generateSlots(): string[] {
  const today = new Date();
  const slots: string[] = [];
  for (let dayOffset = 1; dayOffset <= 5; dayOffset++) {
    const d = new Date(today);
    d.setDate(today.getDate() + dayOffset);
    const day = d.getDay();
    if (day === 5) continue; // Skip Friday
    const dateStr = d.toLocaleDateString('en-GB', { weekday: 'short', month: 'short', day: 'numeric' });
    for (let hour = 8; hour < 20; hour++) {
      for (const min of [0, 30]) {
        const timeStr = `${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
        slots.push(`${dateStr} at ${timeStr}`);
      }
    }
  }
  return slots.slice(0, 6); // Return 6 slots max
}

export const handler = async (event: Record<string, string>) => {
  console.log('Appointment event:', JSON.stringify(event));

  const action    = event.action || 'BOOK';
  const patientId = event.patientId || 'UNKNOWN';
  const contactId = event.contactId || '';

  // ── GET_AVAILABILITY ──────────────────────────────────────────────────
  if (action === 'GET_AVAILABILITY') {
    const rawSlots = generateSlots();

    // Ask Claude to format a friendly message listing the slots
    const prompt = `You are the DigiCall Clinic scheduling assistant.
Here are ${rawSlots.length} available appointment slots:
${rawSlots.map((s, i) => `${i + 1}. ${s}`).join('\n')}

Write a short, friendly message (2-3 sentences) presenting these slots to the patient.
End with: "Please press the number of your preferred slot, or press 0 to speak with a receptionist."
Respond in plain text only, no JSON.`;

    try {
      const res = await bedrock.send(new InvokeModelCommand({
        modelId: MODEL_ID,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify({
          anthropic_version: 'bedrock-2023-05-31',
          max_tokens: 300,
          temperature: 0.3,
          messages: [{ role: 'user', content: prompt }],
        }),
      }));
      const text = JSON.parse(new TextDecoder().decode(res.body))?.content?.[0]?.text || '';
      return { slotsAvailable: 'true', slotsMessage: text, rawSlots: JSON.stringify(rawSlots) };
    } catch (err) {
      console.error('Bedrock slots error:', err);
      const fallback = rawSlots.map((s, i) => `${i + 1}. ${s}`).join('\n');
      return {
        slotsAvailable: 'true',
        slotsMessage: `Available appointments:\n${fallback}\nPlease press the number of your preferred slot, or press 0 to speak with a receptionist.`,
        rawSlots: JSON.stringify(rawSlots),
      };
    }
  }

  // ── BOOK slot ────────────────────────────────────────────────────────
  const slotChoice = parseInt(event.slotChoice || '0', 10);
  const rawSlotsStr = event.rawSlots || '[]';

  let rawSlots: string[] = [];
  try { rawSlots = JSON.parse(rawSlotsStr); } catch { rawSlots = generateSlots(); }

  if (slotChoice < 1 || slotChoice > rawSlots.length) {
    return { bookingSuccess: 'false' };
  }

  const chosenSlot = rawSlots[slotChoice - 1];
  const appointmentId = `APT-${Date.now()}`;
  const authToken = event.authToken || '';

  try {
    await dynamo.send(new PutCommand({
      TableName: APPOINTMENT_TABLE,
      Item: {
        id: appointmentId,
        patientId,
        contactId,
        slot: chosenSlot,
        status: 'CONFIRMED',
        authToken,
        bookedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    }));

    // Ask Claude for a nice confirmation message
    let confirmationMessage = `Your appointment has been confirmed for ${chosenSlot}. You will receive a reminder 24 hours before. Thank you for choosing DigiCall Clinic.`;
    try {
      const res = await bedrock.send(new InvokeModelCommand({
        modelId: MODEL_ID,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify({
          anthropic_version: 'bedrock-2023-05-31',
          max_tokens: 150,
          temperature: 0.3,
          messages: [{
            role: 'user',
            content: `Write a warm, brief (1-2 sentences) appointment confirmation message for: ${chosenSlot} at DigiCall Clinic. Plain text only.`,
          }],
        }),
      }));
      confirmationMessage = JSON.parse(new TextDecoder().decode(res.body))?.content?.[0]?.text || confirmationMessage;
    } catch { /* use default */ }

    return { bookingSuccess: 'true', confirmationMessage, appointmentId };

  } catch (err) {
    console.error('Booking error:', err);
    return { bookingSuccess: 'false' };
  }
};
