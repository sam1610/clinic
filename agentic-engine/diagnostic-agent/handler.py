"""
Lambda handler — Diagnostic Agent step in the Step Functions medical pipeline.

This Lambda sits between the Comprehend Medical entity-extraction step and
the DynamoDB writer step in the state machine.

Step Functions integration mode: Lambda:invoke (RequestResponse).

Expected input (passed verbatim from the previous state's output):
{
  "contactId":        str,
  "patientId":        str,
  "interactionDate":  str,   # ISO-8601
  "s3RecordingUrl":   str | null,
  "rawTranscript":    str,
  "medicalEntities":  {      # Comprehend Medical DetectEntitiesV2 payload
    "entities":       [...],
    "unmappedAttributes": [...]
  },
  "icd10Codes": [            # Mapped ICD-10 codes from previous step
    { "code": str, "description": str, "confidence": float },
    ...
  ]
}

Successful output (passed to the next state — DynamoDB writer):
{
  ...all input fields preserved...,
  "diagnosticSummary": {
    "summary":        str,
    "riskLevel":      "Low" | "Medium" | "High",
    "recommendations": [str, ...]
  }
}

On error the Lambda raises an exception so Step Functions can handle it via
a Catch / Retry block — no HTTP status code wrapping.
"""

import json
import logging
import os
from typing import Any

from .agent import DiagnosticAgent

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

# Lazily initialised at module level so it is reused across warm invocations
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
    Lambda entry-point for the Diagnostic Agent Step Functions task.

    Args:
        event:   The output of the previous Step Functions state (entity extraction).
        context: Lambda execution context (unused, but kept for signature compliance).

    Returns:
        The enriched payload dict with `diagnosticSummary` added.
        Step Functions maps this return value directly to the next state's input.

    Raises:
        ValueError:  Missing required fields — Step Functions should retry or fail fast.
        RuntimeError: Bedrock call failed — Step Functions should Catch and notify.
    """
    logger.info(
        "diagnostic-agent | contactId=%s patientId=%s",
        event.get("contactId", "<missing>"),
        event.get("patientId", "<missing>"),
    )

    # The Step Function passes the full state input as the event.
    # Validate the two most critical fields immediately so errors surface
    # before we hit Bedrock and waste a model call.
    if not event.get("contactId"):
        raise ValueError("Payload is missing required field: contactId")
    if not event.get("patientId"):
        raise ValueError("Payload is missing required field: patientId")
    if not event.get("rawTranscript"):
        raise ValueError("Payload is missing required field: rawTranscript")
    if not isinstance(event.get("medicalEntities"), dict):
        raise ValueError(
            "Payload field 'medicalEntities' must be a dict "
            f"(got {type(event.get('medicalEntities')).__name__})"
        )

    agent = _get_agent()
    result = agent.run(event)

    logger.info(
        "diagnostic-agent | complete | contactId=%s riskLevel=%s",
        result.get("contactId"),
        result.get("diagnosticSummary", {}).get("riskLevel"),
    )

    return result
