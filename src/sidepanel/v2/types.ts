export interface RuleFormState {
  id?: string;
  name: string;
  description: string;
  type: 'regex' | 'custom';
  expression: string;
  enabled: boolean;
}

export interface FindingGroup {
  key: string;
  method: string;
  url: string;
  rules: string[];
  locations: string[];
  count: number;
}
