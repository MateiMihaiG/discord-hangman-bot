export interface GameState {

  word: string;
  masked: string[];          // litere dezvăluite
  wrong: string[];           // litere greșite (pt. afișaj)
  category: string;

  guildId?: string;
  mainChannelId: string;     // canalul "mare" unde se anunță
  threadId: string;          // thread-ul rundei
  messageId?: string;        // mesajul "tabla" din thread
  mainAnnounceId?: string;   // anunțul din canalul mare (opțional, pentru delete)
  startedAt: number;

  contributors: Set<string>;
  attempted: Set<string>;

  roundStart: number;
  roundTimer?: NodeJS.Timeout;     // timeout 120s
  tickTimer?: NodeJS.Timeout;      // refresh embed la 15s
  hintTimers?: NodeJS.Timeout[];   // hint-uri programate (60/40/20 sec)
}
