import axios from 'axios';
import { ConnectionResponse, ISAPair } from '../types';

const REQUEST_TIMEOUT_MS = 15_000;

export async function fetchConnection(
  connectionId: number,
  apiUrl: string,
  apiToken: string,
): Promise<ConnectionResponse> {
  const url = `${apiUrl}/v1/connection/${connectionId}`;
  console.log(`[connection] GET ${url}`);

  const { data, status } = await axios.get<ConnectionResponse[]>(url, {
    headers: { Authorization: `Bearer ${apiToken}` },
    timeout: REQUEST_TIMEOUT_MS,
  });

  console.log(`[connection] Response status=${status}, records=${data?.length ?? 0}`);

  if (!data || data.length === 0) {
    throw new Error(`Connection ${connectionId} not found.`);
  }

  const conn = data[0];
  console.log(`[connection] Found: customer_live=${conn.customer_live_isa_id}, company_live=${conn.company_live_isa_id}, customer_test=${conn.customer_test_isa_id}, company_test=${conn.company_test_isa_id}`);

  return conn;
}

export function extractISAs(conn: ConnectionResponse): { liveISA: ISAPair; testISA: ISAPair } {
  return {
    liveISA: {
      customerISA: conn.customer_live_isa_id,
      companyISA: conn.company_live_isa_id,
    },
    testISA: {
      customerISA: conn.customer_test_isa_id,
      companyISA: conn.company_test_isa_id,
    },
  };
}
