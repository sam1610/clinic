"""
Local smoke-test entry-point for the diagnostic-agent.

Run with:
  uv run python main.py

Simulates the payload that Step Functions passes from the ComprehendMedical
step to the DiagnosticAgent Lambda.

Field names match the Step Functions state machine contract:
  - `transcript`          (not `rawTranscript`)
  - `comprehend_entities` (not `medicalEntities`)
"""

import json
from diagnostic_agent.handler import lambda_handler

SAMPLE_EVENT = {
    "contactId":      "test-contact-001",
    "patientId":      "PAT-99999",
    "date":           "2026-06-11T10:30:00Z",
    "s3RecordingUrl": "s3://clinic-recordings-dev/test-contact-001.wav",

    # `transcript` — plain text from the GetTranscribeResult step
    "transcript": (
        "Agent: Good morning, how can I help you today?\n"
        "Patient: I've been feeling completely hopeless for weeks. I can't sleep, "
        "I've lost my appetite, and I stopped taking my antidepressant medication "
        "last month because I didn't see the point anymore.\n"
        "Agent: I'm sorry to hear that. Can you tell me more about the hopelessness?\n"
        "Patient: I just feel like nothing will ever get better. Sometimes I think "
        "about not being here anymore, but I haven't done anything.\n"
        "Agent: Thank you for sharing that. Are you having thoughts of harming yourself?\n"
        "Patient: Not seriously, but the thoughts are there. I also have panic attacks "
        "almost every day now — heart racing, difficulty breathing, feeling detached "
        "from reality. It's terrifying.\n"
        "Agent: I understand. Have you been seen by a psychiatrist before?\n"
        "Patient: Yes, I was diagnosed with major depressive disorder two years ago "
        "and I was on sertraline, but I stopped. I also think I have PTSD from a car "
        "accident last year. My doctor mentioned it.\n"
        "Agent: We'll arrange an urgent referral. Are you safe right now?\n"
        "Patient: Yes, I'm at home. I won't do anything."
    ),

    # `comprehend_entities` — output from the ComprehendMedical step
    "comprehend_entities": {
        "entities": [
            {
                "Text": "hopeless",
                "Category": "MEDICAL_CONDITION",
                "Type": "DX_NAME",
                "Score": 0.94,
            },
            {
                "Text": "antidepressant medication",
                "Category": "MEDICATION",
                "Type": "GENERIC_NAME",
                "Score": 0.97,
            },
            {
                "Text": "sertraline",
                "Category": "MEDICATION",
                "Type": "BRAND_NAME",
                "Score": 0.99,
            },
            {
                "Text": "panic attacks",
                "Category": "MEDICAL_CONDITION",
                "Type": "DX_NAME",
                "Score": 0.96,
            },
            {
                "Text": "difficulty breathing",
                "Category": "MEDICAL_CONDITION",
                "Type": "DX_NAME",
                "Score": 0.88,
            },
            {
                "Text": "major depressive disorder",
                "Category": "MEDICAL_CONDITION",
                "Type": "DX_NAME",
                "Score": 0.99,
            },
            {
                "Text": "PTSD",
                "Category": "MEDICAL_CONDITION",
                "Type": "DX_NAME",
                "Score": 0.95,
            },
            {
                "Text": "can't sleep",
                "Category": "MEDICAL_CONDITION",
                "Type": "DX_NAME",
                "Score": 0.85,
            },
        ],
        "icd10Codes": [
            {
                "code": "F32.2",
                "description": "Major depressive disorder, single episode, severe without psychotic features",
                "confidence": 0.97,
            },
            {
                "code": "F43.10",
                "description": "Post-traumatic stress disorder, unspecified",
                "confidence": 0.93,
            },
            {
                "code": "F41.0",
                "description": "Panic disorder without agoraphobia",
                "confidence": 0.89,
            },
            {
                "code": "F32.9",
                "description": "Major depressive disorder, single episode, unspecified",
                "confidence": 0.85,
            },
        ],
        "rxNormCodes": [
            {"code": "36437", "description": "sertraline", "confidence": 0.99},
        ],
        "symptoms":    ["hopelessness", "insomnia", "loss of appetite", "panic attacks",
                        "dissociation", "suicidal ideation (passive)"],
        "medications": ["antidepressant medication", "sertraline"],
        "conditions":  ["major depressive disorder", "PTSD", "panic disorder"],
        "procedures":  [],
    },
}


def main() -> None:
    print("Running diagnostic-agent smoke test…\n")
    print("Input contactId:", SAMPLE_EVENT["contactId"])
    print("Transcript length:", len(SAMPLE_EVENT["transcript"]), "chars\n")

    result = lambda_handler(SAMPLE_EVENT, context=None)

    diag = result.get("diagnosticSummary", {})
    print("─── diagnosticSummary ───────────────────────────────────────────")
    print(json.dumps(diag, indent=2, ensure_ascii=False))
    print()
    print("─── riskAssessment ──────────────────────────────────────────────")
    print(diag.get("riskAssessment"))
    print()
    print("─── Full output (truncated) ─────────────────────────────────────")
    # Don't re-print the full transcript in the summary
    display = {k: v for k, v in result.items() if k != "transcript"}
    print(json.dumps(display, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
