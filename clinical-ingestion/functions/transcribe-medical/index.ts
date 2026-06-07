/**
 * transcribe-medical
 *
 * Step Functions Task — Step 1 of the Post-Call Processing pipeline.
 *
 * Receives the CTR payload from the state machine, extracts the
 * recording S3 URI, starts an async Transcribe Medical job, and returns
 * the job name so the Wait state can poll for completion.
 *
 * Input (from EventBridge CTR → Step Functions):
 * {
 *   contactId:     string,
 *   recordingKey:  string,       // S3 object key of the .wav recording
 *   recordingBucket: string,
 *   patientId:     string,
 *   queueName:     string,
 *   agentUsername: string,
 *   channel:       string
 * }
 *
 * Output:
 * {
 *   ...input (pass-through),
 *   transcribeJobName: string,
 *   transcriptOutputKey: string
 * }
 */
import {
  TranscribeClient,
  StartMedicalTranscriptionJobCommand,
  MedicalMediaFormat,
  Specialty,
  Type,
} from '@aws-sdk/client-transcribe';

const transcribe = new TranscribeClient({ region: process.env.AWS_REGION || 'us-east-1' });

const OUTPUT_BUCKET = process.env.TRANSCRIBE_OUTPUT_BUCKET!;
const OUTPUT_PREFIX = process.env.TRANSCRIBE_OUTPUT_PREFIX || 'transcripts/';

export interface TranscribeInput {
  contactId: string;
  recordingKey: string;
  recordingBucket: string;
  patientId: string;
  queueName?: string;
  agentUsername?: string;
  channel?: string;
  riskLevel?: string;
}

export const handler = async (input: TranscribeInput) => {
  console.log('TranscribeMedical input:', JSON.stringify(input));

  const { contactId, recordingKey, recordingBucket } = input;

  const timestamp = Date.now();
  // Job names: max 200 chars, alphanumeric + hyphens only
  const safeContactId = contactId.replace(/[^a-zA-Z0-9]/g, '-').slice(0, 60);
  const jobName = `medical-${safeContactId}-${timestamp}`;

  const transcriptOutputKey = `${OUTPUT_PREFIX}${contactId}/${timestamp}.json`;
  const mediaUri = `s3://${recordingBucket}/${recordingKey}`;

  await transcribe.send(
    new StartMedicalTranscriptionJobCommand({
      MedicalTranscriptionJobName: jobName,
      LanguageCode: 'en-US',
      MediaFormat: 'wav' as MedicalMediaFormat,
      Media: { MediaFileUri: mediaUri },
      OutputBucketName: OUTPUT_BUCKET,
      OutputKey: transcriptOutputKey,
      Specialty: 'PRIMARYCARE' as Specialty,
      Type: 'CONVERSATION' as Type,
      Settings: {
        ShowSpeakerLabels: true,
        MaxSpeakerLabels: 2,
      },
    })
  );

  console.log(`Started Transcribe job: ${jobName}`);

  return {
    ...input,
    transcribeJobName: jobName,
    transcriptOutputKey,
    transcriptOutputBucket: OUTPUT_BUCKET,
  };
};
