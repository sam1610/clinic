"""
Local smoke-test entry-point for the diagnostic-agent.

Run with:
  uv run python main.py

Simulates the payload that Step Functions passes from the entity-extraction
step to the diagnostic-agent Lambda.
"""

import json
from diagnostic_agent.handler import lambda_handler

SAMPLE_EVENT = {
    "contactId":       "test-contact-001",
    "patientId":       "PAT-99999",
    "interactionDate": "2026-06-07T10:30:00Z",
    "s3RecordingUrl":  "s3://clinic-recordings-dev/test-contact-001.wav",
    "rawTranscript":   (
        "Agent: Good morning, how can I help you today?\n"
        "Patient: I've been having severe headaches for the past three days and "
        "I feel very dizzy. I also stopped taking my blood pressure medication "
        "last week because it was making me feel nauseous.\n"
        "Agent: I understand. How severe is the headache on a scale of 1 to 10?\n"
        "Patient: About an 8. I'm really worried, I feel hopeless about it."
    ),
    "medicalEntities": {
        "entities": [
            {"Text": "headaches",            "Category": "MEDICAL_CONDITION", "Type": "DX_NAME",      "Score": 0.98},
            {"Text": "dizzy",                "Category": "MEDICAL_CONDITION", "Type": "DX_NAME",      "Score": 0.92},
            {"Text": "blood pressure medication", "Category": "MEDICATION",   "Type": "GENERIC_NAME", "Score": 0.95},
            {"Text": "nauseous",             "Category": "MEDICAL_CONDITION", "Type": "DX_NAME",      "Score": 0.87},
        ],
        "unmappedAttributes": [],
    },
    "icd10Codes": [
        {"code": "R51",   "description": "Headache",              "confidence": 0.96},
        {"code": "R42",   "description": "Dizziness and giddiness","confidence": 0.91},
        {"code": "Z87.39","description": "Personal history of other endocrine, nutritional and metabolic diseases", "confidence": 0.72},
    ],
}


def main() -> None:
    print("Running diagnostic-agent smoke test…\n")
    result = lambda_handler(SAMPLE_EVENT, context=None)
    print("Output:\n", json.dumps(result, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
