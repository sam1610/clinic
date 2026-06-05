/**
 * clinical-lex-fulfillment
 *
 * Lambda code hook for PsychClinicReception Lex bot.
 * Handles both GhostIntent and FallbackIntent — every message from every
 * chat channel (WhatsApp / WebChat) goes through this function.
 *
 * Design:
 *  1. Receive user utterance from Lex.
 *  2. Invoke Claude 3.5 Sonnet with a clinical system prompt.
 *  3. Claude decides: RESPOND | REQUEST_AUTH | BOOK_APPOINTMENT |
 *     TRANSFER_TO_AGENT | CRISIS_ESCALATE | END_SESSION.
 *  4. Return a Lex ElicitIntent response so the next message loops back here.
 *  5. When action requires a handoff, set session attributes so the
 *     Connect flow (06_WebChatEntryFlow) reads them and routes accordingly.
 */

import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';

const bedrock = new BedrockRuntimeClient({ region: process.env.BEDROCK_REGION || 'us-east-1' });
const dynamo  = DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' }));

const MODEL_ID               = 'anthropic.claude-3-5-sonnet-20241022-v2:0';
const CLINICAL_INTERACTION_TABLE = process.env.CLINICAL_INTERACTION_TABLE!;
const PATIENT_RECORD_TABLE   = process.env.PATIENT_RECORD_TABLE!;

// ── Types ─────────────────────────────────────────────────────────────────
interface LexEvent {
  sessionId: string;
  inputTranscript: string;
  sessionState: {
    intent: { name: string };
    sessionAttributes?: Record<string, string>;
    activeContexts?: unknown[];
  };
  requestAttributes?: Record<string, string>;
}

interface ClaudeDecision {
  action: 'RESPOND' | 'REQUEST_AUTH' | 'BOOK_APPOINTMENT' | 'TRANSFER_TO_AGENT' | 'CRISIS_ESCALATE' | 'END_SESSION';
  response: string;
  crisisDetected?: boolean;
  crisisKeyword?: string;
  requiresAuth?: boolean;
}

// ── System prompt ─────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are the virtual clinical assistant for DigiCall Clinic, a mental health and general medical clinic serving patients in Bahrain and KSA. You communicate via WhatsApp and web chat.

Your responsibilities:
1. Greet patients warmly and understand their need.
2. Answer general clinic questions: hours (Sat-Thu 8am-8pm), location (Manama, Bahrain), services (General Medicine, Psychology, Psychiatry, Counselling), booking info.
3. Collect initial complaint or reason for contact in a compassionate, non-clinical tone.
4. Detect if the patient needs medical support, prescription help, or appointment booking.
5. Detect psychological crisis markers: expressions of self-harm, suicidal ideation, extreme distress, or harm to others.
6. Write in the patient's language (Arabic, English, or French — detect from their message).

Decision rules (choose ONE action per turn):
- "RESPOND": You can answer without escalation. Include your answer in "response".
- "REQUEST_AUTH": Patient wants medical records, prescriptions, or sensitive info. Ask them to verify identity.
- "BOOK_APPOINTMENT": Patient explicitly wants to book an appointment. Confirm name, preferred date/time, service type.
- "TRANSFER_TO_AGENT": Patient requests a human, or you cannot help, or issue is complex clinical.
- "CRISIS_ESCALATE": Any mention of self-harm, suicide, or immediate danger. ALWAYS escalate immediately.
- "END_SESSION": Patient says goodbye and has no more questions.

Always respond in valid JSON:
{
  "action": "RESPOND",
  "response": "Your message here",
  "crisisDetected": false
}`;

// ── Main handler ──────────────────────────────────────────────────────────
export const handler = async (event: LexEvent) => {
  console.log('Lex event:', JSON.stringify(event, null, 2));

  const sessionId      = event.sessionId;
  const userInput      = event.inputTranscript || '';
  const sessionAttrs   = event.sessionState.sessionAttributes || {};
  const patientId      = sessionAttrs.patientId   || 'UNKNOWN';
  const isAuthenticated = sessionAttrs.PatientAuthenticated === 'true';

  // Retrieve conversation history from session attributes (max 10 turns)
  let history: Array<{ role: string; content: string }> = [];
  try {
    history = JSON.parse(sessionAttrs.conversationHistory || '[]');
  } catch { history = []; }

  // Build messages array for Claude
  history.push({ role: 'user', content: userInput });

  // Truncate to last 10 exchanges to stay within token limits
  if (history.length > 20) history = history.slice(-20);

  // Add patient context to the first user message
  const contextPrefix = `[Patient: ${patientId}, Authenticated: ${isAuthenticated}, Channel: ${sessionAttrs.channelType || 'CHAT'}]\n`;

  const messages = history.map((m, i) => ({
    role: m.role as 'user' | 'assistant',
    content: i === 0 ? contextPrefix + m.content : m.content,
  }));

  // ── Call Claude ──────────────────────────────────────────────────────
  let decision: ClaudeDecision;
  try {
    const bedrockRes = await bedrock.send(new InvokeModelCommand({
      modelId: MODEL_ID,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 1024,
        temperature: 0.4,
        system: SYSTEM_PROMPT,
        messages,
      }),
    }));

    const raw = JSON.parse(new TextDecoder().decode(bedrockRes.body));
    const text: string = raw.content?.[0]?.text || '{}';

    // Extract JSON from Claude's response (Claude sometimes adds prose before JSON)
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    decision = jsonMatch ? JSON.parse(jsonMatch[0]) : { action: 'RESPOND', response: text, crisisDetected: false };
  } catch (err) {
    console.error('Bedrock error:', err);
    decision = {
      action: 'RESPOND',
      response: 'I apologize, I am having trouble responding right now. Would you like me to connect you with a human agent?',
      crisisDetected: false,
    };
  }

  console.log('Claude decision:', decision);

  // ── Persist conversation turn to DynamoDB for ACW pipeline ───────────
  if (patientId !== 'UNKNOWN') {
    const interactionId = `INT-${sessionId}-${Date.now()}`;
    try {
      await dynamo.send(new PutCommand({
        TableName: CLINICAL_INTERACTION_TABLE,
        Item: {
          id: interactionId,
          interactionId,
          patientRecordId: patientId,
          transcriptText: `Patient: ${userInput}\nAssistant: ${decision.response}`,
          channel: sessionAttrs.channelType || 'CHAT',
          startTime: new Date().toISOString(),
          connectContactId: sessionId,
          agentId: 'LEX_BOT',
          __typename: 'ClinicalInteraction',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      }));
    } catch (e) {
      console.warn('DynamoDB write failed (non-fatal):', e);
    }
  }

  // ── Store updated history in session ─────────────────────────────────
  history.push({ role: 'assistant', content: decision.response });
  const updatedAttrs: Record<string, string> = {
    ...sessionAttrs,
    conversationHistory: JSON.stringify(history.slice(-20)),
    agentResponse: decision.response,
    action: decision.action,
    crisisDetected: decision.crisisDetected ? 'true' : 'false',
    crisisKeyword: decision.crisisKeyword || '',
    requiresAuth: decision.requiresAuth ? 'true' : 'false',
    escalationFlag: decision.action === 'TRANSFER_TO_AGENT' ? 'true' : 'false',
  };

  // ── Build Lex response ────────────────────────────────────────────────
  // For CRISIS and TRANSFER — set session attributes so Connect flow routes
  // For all others — keep conversation going in ElicitIntent loop
  const shouldTransfer = ['TRANSFER_TO_AGENT', 'CRISIS_ESCALATE'].includes(decision.action);
  const shouldEnd      = decision.action === 'END_SESSION';

  return buildLexResponse(
    decision.response,
    updatedAttrs,
    shouldEnd ? 'Close' : shouldTransfer ? 'Close' : 'ElicitIntent',
    decision.action,
  );
};

// ── Lex response builder ──────────────────────────────────────────────────
function buildLexResponse(
  message: string,
  sessionAttributes: Record<string, string>,
  dialogAction: 'ElicitIntent' | 'Close',
  action: string,
) {
  return {
    sessionState: {
      dialogAction: {
        type: dialogAction,
        ...(dialogAction === 'Close' ? {
          fulfillmentState: action === 'CRISIS_ESCALATE' ? 'Failed' : 'Fulfilled',
        } : {}),
      },
      intent: {
        name: 'GhostIntent',
        state: dialogAction === 'Close' ? 'Fulfilled' : 'InProgress',
      },
      sessionAttributes,
    },
    messages: [
      {
        contentType: 'PlainText',
        content: message,
      },
    ],
  };
}
