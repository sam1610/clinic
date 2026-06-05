import {
  TranscribeClient,
  StartMedicalTranscriptionJobCommand,
  StartMedicalTranscriptionJobCommandInput,
  MedicalTranscriptionJobSummary,
} from '@aws-sdk/client-transcribe';
import { EventBridgeEvent } from 'aws-lambda';

const transcribeClient = new TranscribeClient({});

interface S3ObjectCreatedDetail {
  version: string;
  bucket: {
    name: string;
  };
  object: {
    key: string;
    size: number;
    etag: string;
    sequencer: string;
  };
  'request-id': string;
  requester: string;
}

/**
 * Lambda handler for initiating Amazon Transcribe Medical jobs
 * 
 * Triggered by: EventBridge rule when new recording is uploaded to S3
 * 
 * Process:
 * 1. Extract S3 object details from EventBridge event
 * 2. Generate unique job name
 * 3. Start Transcribe Medical job with medical specialty
 * 4. Job completion triggers next Lambda via EventBridge
 */
export const handler = async (
  event: EventBridgeEvent<'Object Created', S3ObjectCreatedDetail>
): Promise<void> => {
  console.log('Received S3 object created event:', JSON.stringify(event, null, 2));

  const bucketName = event.detail.bucket.name;
  const objectKey = event.detail.object.key;

  // Generate unique job name (max 200 chars, alphanumeric and hyphens only)
  const timestamp = Date.now();
  const sanitizedKey = objectKey
    .replace(/[^a-zA-Z0-9-]/g, '-')
    .substring(0, 150);
  const jobName = `medical-transcription-${sanitizedKey}-${timestamp}`;

  // Extract patient/contact metadata from object key if available
  // Expected format: recordings/{contactId}/{timestamp}.wav
  const keyParts = objectKey.split('/');
  const contactId = keyParts.length > 1 ? keyParts[1] : 'unknown';

  const s3Uri = `s3://${bucketName}/${objectKey}`;
  const outputBucket = process.env.TRANSCRIBE_OUTPUT_BUCKET!;
  const outputPrefix = process.env.TRANSCRIBE_OUTPUT_PREFIX || 'transcripts/';

  console.log(`Starting Transcribe Medical job: ${jobName}`);
  console.log(`Input: ${s3Uri}`);
  console.log(`Output: s3://${outputBucket}/${outputPrefix}`);

  try {
    const params: StartMedicalTranscriptionJobCommandInput = {
      MedicalTranscriptionJobName: jobName,
      LanguageCode: 'en-US', // Adjust based on your region (en-US, en-GB, etc.)
      MediaFormat: 'wav', // Adjust based on your audio format (wav, mp3, mp4, flac)
      Media: {
        MediaFileUri: s3Uri,
      },
      OutputBucketName: outputBucket,
      OutputKey: `${outputPrefix}${contactId}/${timestamp}.json`,
      Specialty: 'PRIMARYCARE', // Options: PRIMARYCARE, CARDIOLOGY, NEUROLOGY, ONCOLOGY, RADIOLOGY, UROLOGY
      Type: 'CONVERSATION', // CONVERSATION or DICTATION
      Settings: {
        ShowSpeakerLabels: true,
        MaxSpeakerLabels: 2, // Patient and clinician
        ChannelIdentification: false,
        ShowAlternatives: false,
      },
      // Optional: Add tags for tracking
      Tags: [
        {
          Key: 'ContactId',
          Value: contactId,
        },
        {
          Key: 'Source',
          Value: 'AmazonConnect',
        },
        {
          Key: 'ProcessingStage',
          Value: 'Transcription',
        },
      ],
    };

    const command = new StartMedicalTranscriptionJobCommand(params);
    const response = await transcribeClient.send(command);

    console.log('Transcribe Medical job started successfully:', {
      jobName: response.MedicalTranscriptionJob?.MedicalTranscriptionJobName,
      status: response.MedicalTranscriptionJob?.TranscriptionJobStatus,
    });

    // EventBridge will automatically trigger the next Lambda when job completes
  } catch (error) {
    console.error('Error starting Transcribe Medical job:', error);
    throw error;
  }
};
