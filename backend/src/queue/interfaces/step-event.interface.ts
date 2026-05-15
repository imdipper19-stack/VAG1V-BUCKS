export type OrderStep =
  | 'validating'
  | 'auth'
  | 'account_selection'
  | 'balance_check'
  | 'proxy_setup'
  | 'browser_launch'
  | 'epic_login'
  | 'region_change'
  | 'purchasing'
  | 'completed'
  | 'failed';

export type StepStatus = 'started' | 'completed' | 'failed';

export interface StepEvent {
  orderId: string;
  step: OrderStep;
  status: StepStatus;
  message: string;
  timestamp: string; // ISO 8601
  progress: number; // 0-100
}
