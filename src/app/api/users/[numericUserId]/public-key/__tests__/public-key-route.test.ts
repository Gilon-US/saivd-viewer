/**
 * Public-key API route tests.
 * GET /api/users/[numericUserId]/public-key - returns RSA public key PEM (no auth).
 */

if (typeof globalThis.Request === "undefined") {
  (globalThis as unknown as { Request: unknown }).Request = class Request {};
}

jest.mock("next/server", () => {
  const headers = new Map<string, string>();
  return {
    NextRequest: class {},
    NextResponse: {
      json: (data: unknown, init?: {status?: number; headers?: Record<string, string>}) => {
        const h = new Map<string, string>(Object.entries(init?.headers ?? {}));
        return {
          json: async () => data,
          status: init?.status ?? 200,
          headers: { get: (name: string) => h.get(name) ?? null },
        };
      },
    },
  };
});

jest.mock("@supabase/supabase-js", () => ({
  createClient: jest.fn(() => ({
    from: jest.fn(() => ({
      select: jest.fn(() => ({
        eq: jest.fn(() => ({
          single: jest.fn(),
        })),
      })),
    })),
  })),
}));

const createClient = require("@supabase/supabase-js").createClient;

// Import after mocks so next/server is mocked
import { GET } from "../route";

type NextRequest = unknown;

describe("GET /api/users/[numericUserId]/public-key", () => {
  const env = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  });

  afterEach(() => {
    process.env = env;
  });

  it("returns 400 for invalid numericUserId (non-integer)", async () => {
    const req = {} as NextRequest;
    const res = await GET(req, {params: Promise.resolve({numericUserId: "abc"})});
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error?.code).toBe("validation_error");
  });

  it("returns 400 for zero", async () => {
    const req = {} as NextRequest;
    const res = await GET(req, {params: Promise.resolve({numericUserId: "0"})});
    expect(res.status).toBe(400);
  });

  it("returns 400 for negative", async () => {
    const req = {} as NextRequest;
    const res = await GET(req, {params: Promise.resolve({numericUserId: "-1"})});
    expect(res.status).toBe(400);
  });

  it("returns 500 when Supabase config is missing", async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const req = {} as NextRequest;
    const res = await GET(req, {params: Promise.resolve({numericUserId: "123"})});
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error?.code).toBe("server_error");
  });

  it("returns 404 when profile not found", async () => {
    const mockSingle = jest.fn().mockResolvedValue({
      data: null,
      error: {code: "PGRST116", message: "Row not found"},
    });
    (createClient as jest.Mock).mockReturnValue({
      from: jest.fn(() => ({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            single: mockSingle,
          })),
        })),
      })),
    });

    const req = {} as NextRequest;
    const res = await GET(req, {params: Promise.resolve({numericUserId: "999999"})});
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error?.code).toBe("not_found");
  });

  it("returns 200 with public_key_pem and creator_user_id when profile exists", async () => {
    const mockSingle = jest.fn().mockResolvedValue({
      data: {
        id: "uuid-creator-1",
        public_key_pem: "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkq\n-----END PUBLIC KEY-----\n",
      },
      error: null,
    });
    (createClient as jest.Mock).mockReturnValue({
      from: jest.fn(() => ({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            single: mockSingle,
          })),
        })),
      })),
    });

    const req = {} as NextRequest;
    const res = await GET(req, {params: Promise.resolve({numericUserId: "123"})});
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data?.public_key_pem).toContain("BEGIN PUBLIC KEY");
    expect(body.data?.creator_user_id).toBe("uuid-creator-1");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("returns 404 when profile has no public_key_pem", async () => {
    const mockSingle = jest.fn().mockResolvedValue({
      data: {id: "uuid-1", public_key_pem: null},
      error: null,
    });
    (createClient as jest.Mock).mockReturnValue({
      from: jest.fn(() => ({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            single: mockSingle,
          })),
        })),
      })),
    });

    const req = {} as NextRequest;
    const res = await GET(req, {params: Promise.resolve({numericUserId: "123"})});
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error?.code).toBe("not_found");
  });
});
