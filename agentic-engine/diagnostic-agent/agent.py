"""
DiagnosticAgent — Step Functions pipeline step.

Receives the post-call payload from the Comprehend Medical extraction step,
calls Amazon Bedrock / Claude to produce a structured psychiatric diagnostic
proposition, and returns the enriched payload for the next state
(save-historical-interaction Lambda).

────────────────────────────────────────────────────────────────────────────
Input contract  (from Step Functions — Comprehend Medical output):
────────────────────────────────────────────────────────────────────────────
{
  "contactId":           str,    # Amazon Connect ContactId
  "patientId":           str,    # PatientRecord.patientId
  "date":                str,    # ISO-8601 datetime (contact start)
  "s3RecordingUrl":      str,    # S3 URI of call recording (may be null)
  "transcript":          str,    # Full plain-text transcript (Transcribe Medical)
  "comprehend_entities": {       # Comprehend Medical output from previous step
    "entities":    [...],        # DetectEntitiesV2 entity list
    "icd10Codes":  [...],        # InferICD10CM results
    "rxNormCodes": [...],        # InferRxNorm results
    "symptoms":    [str, ...],
    "medications": [str, ...],
    "conditions":  [str, ...],
    "procedures":  [str, ...]
  }
}

────────────────────────────────────────────────────────────────────────────
Output contract  (passed to save-historical-interaction Lambda):
────────────────────────────────────────────────────────────────────────────
{
  ...all input fields preserved...,
  "diagnosticSummary": {
    "diagnosticSummary":      str,          # Narrative psychiatric summary
    "differentialDiagnoses":  [str, ...],   # 2–4 possible diagnoses
    "recommendedActions":     [str, ...],   # 2–5 immediate clinical actions
    "riskAssessment":         str           # "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"
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


# ── Prompt ────────────────────────────────────────────────────────────────────

_SYSTEM_PROMPT = """\
You are a senior consultant psychiatrist and clinical decision-support system \
operating within a multi-modal healthcare contact centre serving patients in \
Bahrain and KSA.

Your role is to read a patient call transcript and the medical entities \
extracted from it by AWS Comprehend Medical, then formulate a structured \
psychiatric diagnostic proposition for the attending clinician or psychologist.

Rules:
- Base every statement strictly on the provided transcript and entities. \
  Do NOT invent symptoms, medications, or diagnoses that are not present.
- Give particular attention to psychiatric and psychological risk markers: \
  hopelessness, self-harm ideation, suicidal language, severe anxiety, \
  dissociation, psychosis indicators, substance misuse, and acute distress.
- Assign a single risk level using EXACTLY one of: LOW, MEDIUM, HIGH, CRITICAL.
  Use CRITICAL only for immediate risk of harm to self or others.
- Keep the narrative diagnostic summary under 300 words.
- Provide 2–5 concrete, actionable clinical recommendations.
- Provide 2–4 differential diagnoses to investigate.

Respond with ONLY a valid JSON object — no preamble, no markdown fences:
{
  "diagnosticSummary":     "<narrative psychiatric diagnostic proposition>",
  "differentialDiagnoses": ["<diagnosis 1>", "<diagnosis 2>"],
  "recommendedActions":    ["<action 1>", "<action 2>"],
  "riskAssessment":        "LOW|MEDIUM|HIGH|CRITICAL"
}
"""

_USER_TEMPLATE = """\
Read this transcript and these extracted medical entities. \
Formulate a structured psychiatric diagnostic proposition.

## Call Transcript
{transcript}

## Extracted Medical Entities (Comprehend Medical)
{entities_block}

## ICD-10 Codes Mapped
{icd10_block}

## Identified Symptoms
{symptoms_block}

## Identified Medications
{medications_block}

Produce the structured psychiatric diagnostic JSON now.
"""

_VALID_RISK_LEVELS = frozenset({"LOW", "MEDIUM", "HIGH", "CRITICAL"})


# ── Formatting helpers ────────────────────────────────────────────────────────

def _format_entities(comprehend_entities: dict) -> str:
    """
    Render the Comprehend Medical entity list as a human-readable grouped
    block so Claude doesn't have to parse raw JSON in the context window.
    """
    entities: list[dict] = comprehend_entities.get("entities", [])
    if not entities:
        return "No entities extracted."

    groups: dict[str, list[str]] = {}
    for e in entities:
        cat = e.get("Category", "OTHER")
        score = e.get("Score", 0.0)
        text = e.get("Text", "")
        groups.setdefault(cat, []).append(f"{text} (confidence={score:.0%})")

    return "\n".join(
        f"  {cat}: {', '.join(items)}"
        for cat, items in sorted(groups.items())
    )


def _format_icd10(comprehend_entities: dict) -> str:
    codes: list[dict] = comprehend_entities.get("icd10Codes", [])
    if not codes:
        return "No ICD-10 codes mapped."
    return "\n".join(
        f"  {c.get('code', '?')} — {c.get('description', '')} "
        f"(confidence={c.get('confidence', 0):.0%})"
        for c in codes
    )


def _format_list(items: list[str], empty_msg: str = "None identified.") -> str:
    if not items:
        return empty_msg
    return "\n".join(f"  • {item}" for item in items)


def _extract_json(text: str) -> dict:
    """
    Extract the first valid JSON object from Claude's reply.
    Handles cases where the model wraps output in markdown code fences.
    """
    cleaned = re.sub(r"```(?:json)?", "", text).strip().rstrip("`").strip()
    start = cleaned.find("{")
    end   = cleaned.rfind("}") + 1
    if start == -1 or end == 0:
        raise ValueError(f"No JSON object found in response: {text[:300]}")
    return json.loads(cleaned[start:end])


# ── Agent ─────────────────────────────────────────────────────────────────────

class DiagnosticAgent:
    """
    Step Functions pipeline step:
      transcript + comprehend_entities → structured psychiatric diagnostic proposition

    The class is stateless. Each call to run() is independent, making the
    Lambda safe for concurrent Step Functions executions.
    """

    def __init__(self, region: str = "us-east-1") -> None:
        self.bedrock = BedrockClient(region=region)

    def run(self, payload: dict[str, Any]) -> dict[str, Any]:
        """
        Execute the psychiatric diagnostic reasoning step.

        Args:
            payload: Validated Step Functions input (see module docstring).

        Returns:
            The payload dict with a `diagnosticSummary` key added, ready
            for the save-historical-interaction Lambda.

        Raises:
            ValueError:  Required fields are missing from the payload.
            RuntimeError: Bedrock returned an unparseable response.
        """
        # ── Validate ──────────────────────────────────────────────────────
        required = ("contactId", "patientId", "transcript", "comprehend_entities")
        missing  = [f for f in required if not payload.get(f)]
        if missing:
            raise ValueError(f"Missing required payload fields: {missing}")

        transcript: str            = payload["transcript"]
        comprehend_entities: dict  = payload["comprehend_entities"]

        logger.info(
            "DiagnosticAgent.run | contactId=%s patientId=%s "
            "transcript_chars=%d entities=%d",
            payload["contactId"],
            payload["patientId"],
            len(transcript),
            len(comprehend_entities.get("entities", [])),
        )

        # ── Build prompt ──────────────────────────────────────────────────
        user_message = _USER_TEMPLATE.format(
            # Clip to ~6 000 chars — keeps the context window lean while
            # preserving the bulk of the clinical conversation.
            transcript=transcript[:6_000],
            entities_block=_format_entities(comprehend_entities),
            icd10_block=_format_icd10(comprehend_entities),
            symptoms_block=_format_list(comprehend_entities.get("symptoms", [])),
            medications_block=_format_list(comprehend_entities.get("medications", [])),
        )

        # ── Invoke Bedrock / Claude ───────────────────────────────────────
        logger.info("Invoking Bedrock for psychiatric diagnostic proposition…")
        response = self.bedrock.invoke(
            system_prompt=_SYSTEM_PROMPT,
            user_message=user_message,
            max_tokens=1_024,
            temperature=0.2,   # Low temperature for reproducible clinical output
        )

        raw_text = self.bedrock.extract_text_content(response)
        logger.info("Bedrock response: %d chars", len(raw_text))

        # ── Parse response ────────────────────────────────────────────────
        try:
            parsed = _extract_json(raw_text)
        except (ValueError, json.JSONDecodeError) as exc:
            logger.warning("JSON parse failed (%s) — applying safe fallback", exc)
            parsed = {
                "diagnosticSummary":     raw_text[:2_000],
                "differentialDiagnoses": [],
                "recommendedActions":    ["Manual clinical review required."],
                "riskAssessment":        "MEDIUM",
            }

        # ── Normalise and validate risk level ─────────────────────────────
        raw_risk = str(parsed.get("riskAssessment", "")).upper().strip()
        risk_assessment = raw_risk if raw_risk in _VALID_RISK_LEVELS else "MEDIUM"

        diagnostic_summary: dict[str, Any] = {
            "diagnosticSummary":     parsed.get("diagnosticSummary", ""),
            "differentialDiagnoses": parsed.get("differentialDiagnoses", []),
            "recommendedActions":    parsed.get("recommendedActions", []),
            "riskAssessment":        risk_assessment,
        }

        logger.info(
            "DiagnosticAgent complete | contactId=%s riskAssessment=%s "
            "differentials=%d actions=%d",
            payload["contactId"],
            risk_assessment,
            len(diagnostic_summary["differentialDiagnoses"]),
            len(diagnostic_summary["recommendedActions"]),
        )

        # Return the full payload enriched with the diagnostic proposition.
        # Step Functions passes this verbatim to the next state.
        return {**payload, "diagnosticSummary": diagnostic_summary}
