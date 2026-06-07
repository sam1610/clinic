"""
Diagnostic Agent — Step Functions pipeline step.

Receives the enriched post-call payload from the previous pipeline step
(Comprehend Medical entity extraction), calls Amazon Bedrock / Claude to
produce a structured clinical diagnostic summary, and returns that summary
as a plain Python dict so the Step Function can pass it to the next state
(DynamoDB writer Lambda).

Input contract (from Step Functions):
{
  "contactId":        str,   # Amazon Connect contact ID
  "patientId":        str,   # PatientRecord.patientId
  "interactionDate":  str,   # ISO-8601 datetime
  "s3RecordingUrl":   str,   # S3 URI of call recording (optional)
  "rawTranscript":    str,   # Full text transcript from Transcribe Medical
  "medicalEntities":  dict,  # Comprehend Medical DetectEntitiesV2 response
  "icd10Codes":       list   # Mapped ICD-10 codes from the previous step
}

Output contract (passed to next Step Functions state):
{
  ...all input fields preserved...,
  "diagnosticSummary": {
    "summary":          str,
    "riskLevel":        "Low" | "Medium" | "High",
    "recommendations":  list[str]
  }
}
"""

import json
import logging
import re
from typing import Any

from shared.bedrock_client import BedrockClient

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

# ── Prompt ───────────────────────────────────────────────────────────────────

_SYSTEM_PROMPT = """\
You are an expert clinical diagnostician and psychologist working in a \
multi-modal healthcare contact centre (Bahrain / KSA).

You will receive:
1. A verbatim call transcript (from Amazon Transcribe Medical).
2. A list of structured medical entities already extracted from that \
   transcript by AWS Comprehend Medical.
3. A list of ICD-10 codes mapped from those entities.

Your task is to produce a concise, evidence-based diagnostic summary for \
the attending medical staff or psychologist who will review the record.

Rules:
- Base every statement strictly on the provided transcript and entities. \
  Do NOT invent symptoms, medications, or diagnoses.
- Flag psychological risk markers (hopelessness, self-harm ideation, \
  severe anxiety, suicidal language, substance misuse) explicitly.
- Assign a single risk level: Low | Medium | High.
- Keep the narrative summary under 300 words.
- Provide 1–5 actionable recommendations for the care team.

Respond with ONLY a JSON object — no preamble, no markdown fences:
{
  "summary": "<narrative summary>",
  "riskLevel": "Low|Medium|High",
  "recommendations": ["...", "..."]
}
"""

_USER_TEMPLATE = """\
## Call Transcript
{transcript}

## Extracted Medical Entities (Comprehend Medical)
{entities_block}

## Mapped ICD-10 Codes
{icd10_block}

Produce the diagnostic summary JSON now.
"""

# ── Helpers ───────────────────────────────────────────────────────────────────

def _format_entities(medical_entities: dict) -> str:
    """
    Render the Comprehend Medical entity list as a compact, readable block
    so Claude doesn't have to parse raw JSON in its prompt.
    """
    entities: list[dict] = medical_entities.get("entities", [])
    if not entities:
        return "No entities extracted."

    # Group by category
    groups: dict[str, list[str]] = {}
    for e in entities:
        cat = e.get("Category", "OTHER")
        groups.setdefault(cat, []).append(
            f"{e.get('Text', '')} (score={e.get('Score', 0):.2f})"
        )

    lines = []
    for cat, items in sorted(groups.items()):
        lines.append(f"  {cat}: {', '.join(items)}")
    return "\n".join(lines)


def _format_icd10(icd10_codes: list) -> str:
    if not icd10_codes:
        return "No ICD-10 codes mapped."
    return "\n".join(
        f"  {c.get('code', '?')} — {c.get('description', '')} "
        f"(confidence={c.get('confidence', 0):.0%})"
        for c in icd10_codes
    )


def _extract_json(text: str) -> dict:
    """
    Pull the first JSON object out of Claude's reply.
    Handles the case where the model wraps output in markdown fences.
    """
    # Strip markdown fences if present
    cleaned = re.sub(r"```(?:json)?", "", text).strip().rstrip("`").strip()
    # Find the outermost {...}
    start = cleaned.find("{")
    end   = cleaned.rfind("}") + 1
    if start == -1 or end == 0:
        raise ValueError(f"No JSON object found in response: {text[:200]}")
    return json.loads(cleaned[start:end])


# ── Agent class ───────────────────────────────────────────────────────────────

class DiagnosticAgent:
    """
    Step Functions pipeline step: transcript + entities → diagnostic summary.

    The class is intentionally stateless. Each invocation creates a fresh
    Bedrock call so the Lambda can be reused safely across concurrent
    Step Function executions.
    """

    def __init__(self, region: str = "us-east-1") -> None:
        self.bedrock = BedrockClient(region=region)

    def run(self, payload: dict[str, Any]) -> dict[str, Any]:
        """
        Execute the diagnostic reasoning step.

        Args:
            payload: Validated Step Functions input (see module docstring).

        Returns:
            The same payload with a `diagnosticSummary` key added.

        Raises:
            ValueError: If required fields are missing from the payload.
            RuntimeError: If Bedrock returns an unparseable response after retries.
        """
        # ── Validate required fields ──────────────────────────────────────
        required = ("contactId", "patientId", "rawTranscript", "medicalEntities")
        missing = [f for f in required if not payload.get(f)]
        if missing:
            raise ValueError(f"Missing required payload fields: {missing}")

        transcript: str       = payload["rawTranscript"]
        medical_entities: dict = payload["medicalEntities"]
        icd10_codes: list     = payload.get("icd10Codes", [])

        logger.info(
            "DiagnosticAgent.run | contactId=%s patientId=%s entities=%d icd10=%d",
            payload["contactId"],
            payload["patientId"],
            len(medical_entities.get("entities", [])),
            len(icd10_codes),
        )

        # ── Build prompt ──────────────────────────────────────────────────
        user_message = _USER_TEMPLATE.format(
            # Truncate to ~6 000 chars to stay within context while leaving
            # room for the entity/ICD blocks and the model's output.
            transcript=transcript[:6_000],
            entities_block=_format_entities(medical_entities),
            icd10_block=_format_icd10(icd10_codes),
        )

        # ── Invoke Claude ─────────────────────────────────────────────────
        logger.info("Invoking Bedrock / Claude for diagnostic summary…")
        response = self.bedrock.invoke(
            system_prompt=_SYSTEM_PROMPT,
            user_message=user_message,
            max_tokens=1_024,
            temperature=0.2,   # Low temperature — reproducible clinical output
        )

        raw_text = self.bedrock.extract_text_content(response)
        logger.info("Bedrock response received (%d chars)", len(raw_text))

        # ── Parse response ────────────────────────────────────────────────
        try:
            diagnostic_data = _extract_json(raw_text)
        except (ValueError, json.JSONDecodeError) as exc:
            logger.warning("JSON parse failed (%s) — using safe fallback", exc)
            diagnostic_data = {
                "summary": raw_text[:2_000],   # preserve whatever text came back
                "riskLevel": "Medium",
                "recommendations": ["Manual clinical review required."],
            }

        # Normalise riskLevel in case Claude drifts
        risk = diagnostic_data.get("riskLevel", "Medium")
        if risk not in ("Low", "Medium", "High"):
            risk = "Medium"

        diagnostic_summary = {
            "summary":         diagnostic_data.get("summary", ""),
            "riskLevel":       risk,
            "recommendations": diagnostic_data.get("recommendations", []),
        }

        # ── Return enriched payload ───────────────────────────────────────
        return {**payload, "diagnosticSummary": diagnostic_summary}
