export interface EventStream {
  did: string;
  time_us: number;
  type: string;
  commit?: {
    rev: string;
    type: string;
    collection: string;
    rkey: string;
    record: {
      $type: string;
      createdAt: string;
      subject: {
        cid: string;
        uri: string;
      };
    };
  };
}
