/**
 * bedrock-diagnostic
 *
 * Step Functions Task — Step 4 of the Post-Call Processing pipeline.
 *
 * Receives the Comprehend Medical entity payload, constructs a clinical
 * prompt, and invokes Amazon Bedrock (Claude v3 Sonnet) to produce a
 * structured diagnostic summary for the clinician.
 *
 * Input:
 * {
 *   ...previous state output,
 *   transcriptText: string,
 *   symptoms:    string[],
 *   medications: string[],
 *   conditions:  string[],
 *   procedures:  string[],
 *   icd10Codes:  object[],
 *   rxNormCodes: object[]
 * }
 *
 * Output:
 * {
 *   ...input (pass-through),
 *   diagnosticSummary: string,
 *   differentialDiagnoses: string[],
 *   recommendedActions: string[],
 *   riskAssessment: string
 * }
 */
import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';

const bedrock = new BedrockRuntimeClient({
  region: process.env.AWS_REGION || 'us-east-1',
});

const MODEL_ID = process.env.BEDROCK_MODEL_ID || 'anthropic.claude-3-sonnet-20240229-v1:0';

interface DiagnosticInput {
  contactId: string;
  patientId?: string;
  transcriptText?: string;
  symptoms?: string[];
  medications?: string[];
  conditions?: string[];
  procedures?: string[];
  icd10Codes?: object[];
  rxNormCodes?: object[];
  riskLevel?: string;
  [key: string]: unknown;
}

interface ClaudeResponse {
  content: Array<{ type: string; text: string }>;
}

interface DiagnosticResult {
  diagnosticSummary: string;
  differentialDiagnoses: string[];
  recommendedActions: string[];
  riskAssessment: string;
}

function buildPrompt(input: DiagnosticInput): string {
  const symptoms   = (input.symptoms   ?? []).join(', ') || 'None identified';
  const medications= (input.medications ?? []).join(', ') || 'None identified';
  const conditions = (input.conditions  ?? []).join(', ') || 'None identified';
  const procedures = (input.procedures  ?? []).join(', ') || 'None identified';
  const icd10      = (input.icd10Codes  ?? []).length;
  const transcript = (input.transcriptText ?? '').slice(0, 3000); // clip for token budget

  return `You are a clinical decision support assistant. Based on the following patient interaction data, provide a structured clinical assessment.

## Extracted Clinical Data
- **Symptoms / Medical Conditions**: ${symptoms}
- **Medications Mentioned**: ${medications}
- **Diagnoses / Conditions**: ${conditions}
- **Procedures Mentioned**: ${procedures}
- **ICD-10 Codes Detected**: ${icd10} code(s)
- **Risk Level**: ${input.riskLevel ?? 'UNKNOWN'}

## Call Transcript (excerpt)
${transcript || 'No transcript available'}

## Task
Provide a concise clinical assessment in JSON format with these fields:
1. "diagnosticSummary": A 2–3 sentence clinical summary of the patient's presentation.
2. "differentialDiagnoses": An array of 2–4 possible diagnoses to investigate.
3. "recommendedActions": An array of 2–4 immediate recommended clinical actions.
4. "riskAssessment": One of: "LOW", "MEDIUM", "HIGH", "CRITICAL" with a brief justification.

Respond with ONLY a JSON object — no markdown, no preamble.`;
}

function parseBedrockResponse(raw: string): DiagnosticResult {
  try {
    // Strip any accidental markdown code fences
    const cleaned = raw.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();
    return JSON.parse(cleaned) as DiagnosticResult;
  } catch {
    console.warn('Could not parse Bedrock JSON response; using fallback');
    return {
      diagnosticSummary: raw.slice(0, 500),
      differentialDiagnoses: [],
      recommendedActions: ['Manual clinical review required'],
      riskAssessment: 'UNKNOWN — parse error',
    };
  }
}

export const handler = async (input: DiagnosticInput) => {
  console.log('BedrockDiagnostic input:', JSON.stringify({
    contactId: input.contactId,
    symptomsCount: input.symptoms?.length,
    conditionsCount: input.conditions?.length,
  }));

  const prompt = buildPrompt(input);

  const body = JSON.stringify({
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: prompt,
      },
    ],
  });

  const response = await bedrock.send(
    new InvokeModelCommand({
      modelId: MODEL_ID,
      contentType: 'application/json',
      accept: 'application/json',
      body: Buffer.from(body),
    })
  );

  const responseText = new TextDecoder().decode(response.body);
  const parsed = JSON.parse(responseText) as ClaudeResponse;
  const assistantText = parsed.content?.[0]?.text ?? '';

  const diagnostic = parseBedrockResponse(assistantText);

  console.log('Diagnostic result:', JSON.stringify(diagnostic));

  return {
    ...input,
    ...diagnostic,
  };
};
