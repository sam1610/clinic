"""
Lambda handler — Diagnostic Agent step in the Step Functions medical pipeline.

────────────────────────────────────────────────────────────────────────────
Position in the pipeline
────────────────────────────────────────────────────────────────────────────

  EventBridge (CTR disconnect)
      └── Step Functions Express State Machine
              ├── 1. TranscribeMedical       (start async job)
              ├── 2. GetTranscribeResult     (poll + extract text)
              ├── 3. ComprehendMedical       (entity extraction)
              ├── 4. DiagnosticAgent  ◄──── THIS LAMBDA
              └── 5. SaveHistoricalInteraction (DynamoDB write)

────────────────────────────────────────────────────────────────────────────
Input  (Step Functions passes the ComprehendMedical output verbatim)
────────────────────────────────────────────────────────────────────────────
{
  "contactId":           str,
  "patientId":           str,
  "date":                str,          # ISO-8601
  "s3RecordingUrl":      str | null,
  "transcript":          str,          # plain-text transcript
  "comprehend_entities": {
    "entities":    [...],
    "icd10Codes":  [...],
    "rxNormCodes": [...],
    "symptoms":    [str, ...],
    "medications": [str, ...],
    "conditions":  [str, ...],
    "procedures":  [str, ...]
  }
}

────────────────────────────────────────────────────────────────────────────
Output  (Step Functions passes this to save-historical-interaction Lambda)
────────────────────────────────────────────────────────────────────────────
{
  ...all input fields preserved...,
  "diagnosticSummary": {
    "diagnosticSummary":      str,
    "differentialDiagnoses":  [str, ...],
    "recommendedActions":     [str, ...],
    "riskAssessment":         "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"
  }
}

────────────────────────────────────────────────────────────────────────────
Error handling
────────────────────────────────────────────────────────────────────────────
The handler raises exceptions directly. Step Functions catches them via the
Catch / Retry blocks defined in the CDK state machine definition.
No HTTP status code wrapping — this is a Lambda:invoke integration.

Environment variables:
  BEDROCK_REGION  — AWS region for the Bedrock API call (default: us-east-1)
"""

import json
import logging
import os
from typing import Any

from .agent import DiagnosticAgent

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

# Reuse the agent across warm Lambda invocations to avoid re-creating the
# Bedrock boto3 client on every execution.
_agent: DiagnosticAgent | None = None


def _get_agent() -> DiagnosticAgent:
    global _agent
    if _agent is None:
        region = os.environ.get("BEDROCK_REGION", "us-east-1")
        logger.info("Initialising DiagnosticAgent (region=%s)", region)
        _agent = DiagnosticAgent(region=region)
    return _agent


def lambda_handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """
    Lambda entry-point for the Step Functions DiagnosticAgent task.

    Args:
        event:   Output of the previous Step Functions state (ComprehendMedical).
                 Must contain `transcript` and `comprehend_entities`.
        context: Lambda execution context (unused beyond logging).

    Returns:
        Enriched payload dict with `diagnosticSummary` added.
        Step Functions maps this return value directly to the next state's input
        (save-historical-interaction Lambda).

    Raises:
        ValueError:   Missing required fields — fast-fail, no retry value.
        RuntimeError: Bedrock call or parse failure — Step Functions should Retry.
    """
    contact_id = event.get("contactId", "<missing>")
    patient_id = event.get("patientId", "<missing>")

    logger.info(
        "diagnostic-agent invoked | contactId=%s patientId=%s",
        contact_id,
        patient_id,
    )

    # ── Guard: required fields ────────────────────────────────────────────
    # Fail fast with a clear message before spending a Bedrock call.

    if not event.get("contactId"):
        raise ValueError("Payload missing required field: contactId")

    if not event.get("patientId"):
        raise ValueError("Payload missing required field: patientId")

    # ── Normalise field names ─────────────────────────────────────────────
    # The agent contract uses `transcript` and `comprehend_entities`.
    # The TypeScript pipeline steps may pass `transcriptText` and individual
    # entity arrays. Remap here so the agent is decoupled from upstream naming.

    normalised = dict(event)  # shallow copy — do not mutate the original event

    # transcript: accept `transcript` (agent contract) or `transcriptText` (TS pipeline)
    if not normalised.get("transcript") and normalised.get("transcriptText"):
        normalised["transcript"] = normalised["transcriptText"]

    if not normalised.get("transcript"):
        raise ValueError(
            "Payload missing required field: transcript (also checked transcriptText). "
            "Ensure the GetTranscribeResult step ran successfully."
        )

    # comprehend_entities: accept nested dict (agent contract) or flat entity
    # fields at the top level as returned by the TypeScript comprehend-medical Lambda.
    if not isinstance(normalised.get("comprehend_entities"), dict):
        # Attempt to assemble from flat top-level fields
        flat_entities = normalised.get("entities")
        if isinstance(flat_entities, list):
            normalised["comprehend_entities"] = {
                "entities":    flat_entities,
                "icd10Codes":  normalised.get("icd10Codes", []),
                "rxNormCodes": normalised.get("rxNormCodes", []),
                "symptoms":    normalised.get("symptoms", []),
                "medications": normalised.get("medications", []),
                "conditions":  normalised.get("conditions", []),
                "procedures":  normalised.get("procedures", []),
            }
        else:
            raise ValueError(
                "Payload missing required field: comprehend_entities (also checked top-level "
                "entities list). Ensure the ComprehendMedical step ran successfully."
            )

    # ── Run the diagnostic agent ──────────────────────────────────────────
    agent  = _get_agent()
    result = agent.run(normalised)

    diag   = result.get("diagnosticSummary", {})
    logger.info(
        "diagnostic-agent complete | contactId=%s riskAssessment=%s",
        result.get("contactId"),
        diag.get("riskAssessment"),
    )

    return result
