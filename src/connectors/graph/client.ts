export interface GraphMessage {
  id: string;
  subject: string | null;
  bodyPreview: string | null;
  webLink: string | null;
  receivedDateTime: string | null;
  from?: {
    emailAddress?: {
      name: string;
      address: string;
    };
  };
}

// Task 8 adds fetchInboxDelta
