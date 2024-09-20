export type EventType = 'com' | 'acc' | 'id';
export type CommitOpType = 'c' | 'u' | 'd';

export interface JetstreamSubject {
  cid: string;
  uri: string;
}

export interface JetstreamCommit {
  rev?: string;
  type: CommitOpType;
  collection?: string;
  rkey?: string;
  cid?: string;
  record?: string; // BskyFeedPostRecord in JSON format
}

export interface JetstreamEvent {
  did: string;
  time_us: number;
  type: EventType;
  commit?: JetstreamCommit;
}

export interface OperationsByType {
  posts: JetstreamEvent[];
}
