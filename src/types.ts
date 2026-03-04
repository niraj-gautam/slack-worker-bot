export type Organization = 'medlog' | 'universal' | 'forwardair' | 'portpro';
export type Environment = 'production' | 'sandbox';

export interface ISAPair {
  customerISA: string;
  companyISA: string;
}

export interface WorkerSpec {
  connectionId?: number;
  liveISA?: ISAPair;
  testISA?: ISAPair;
  name?: string;
}

export interface WorkerRequest {
  org: Organization;
  env: Environment;
  workers: WorkerSpec[];
  branch?: string;
}

export interface ResolvedWorker {
  liveISA: ISAPair;
  testISA: ISAPair;
  name?: string;
}

export interface WorkerEntry {
  name: string;
  topic: string;
  port: string;
  orgIncludesNodeEnv: boolean;
}

export interface WorkerResult {
  name: string;
  topic: string;
  port: string;
  status: 'created' | 'duplicate';
}

export interface OrgEnvMapping {
  file: string;
  branch: string;
  connectionApiUrl: string;
  connectionApiToken: string;
}

export interface ConnectionResponse {
  id: number;
  connection_name: string;
  customer_live_isa_id: string;
  customer_test_isa_id: string;
  company_live_isa_id: string;
  company_test_isa_id: string;
  status: 'LIVE' | 'TEST';
}
