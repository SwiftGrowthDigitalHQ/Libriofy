import { beforeEach, describe, expect, it, vi } from "vitest";

const createClientMock = vi.fn();

vi.mock("@supabase/supabase-js", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

import { handleStudentApiRequest, type StudentApiRequest, type StudentApiResponse } from "@/lib/studentApiRoute.server";

type QueryState = {
  maybeSingle: boolean;
  mode: "select" | "update" | "insert";
  payload: Record<string, unknown> | null;
  table: string;
};

const baseStudent = {
  aadhaar_number: null,
  address: "Old address",
  expiry_date: "2026-06-30",
  full_name: "Old Student",
  gender: "male",
  id: "student-1",
  library_id: "lib-1",
  notes: null,
  phone: "9000000000",
  plan: "Starter",
  seat_id: null,
  seat_number: "A1",
  start_date: "2026-06-01",
  status: "active",
};

const profileRow = {
  email: "owner@example.com",
  full_name: "Owner Name",
  phone_number: "9999999999",
  user_id: "user-1",
};

const libraryRow = {
  id: "lib-1",
  owner_id: "user-1",
};

const makeQueryResult = (state: QueryState) => {
  if (state.table === "profiles") {
    return { data: profileRow, error: null };
  }

  if (state.table === "user_roles") {
    return { data: [{ library_id: "lib-1", role: "library_owner" }], error: null };
  }

  if (state.table === "libraries") {
    return { data: libraryRow, error: null };
  }

  if (state.table === "plans") {
    return {
      data: [
        {
          id: "plan-1",
          is_active: true,
          name: "Starter",
          price: 0,
        },
      ],
      error: null,
    };
  }

  if (state.table === "payments") {
    return { data: [], error: null };
  }

  if (state.table === "students" && state.mode === "update") {
    const payload = state.payload ?? {};
    return {
      data: {
        ...baseStudent,
        address: payload.address ?? null,
        expiry_date: payload.expiry_date ?? null,
        full_name: payload.full_name ?? baseStudent.full_name,
        gender: payload.gender ?? baseStudent.gender,
        notes: payload.notes ?? null,
        phone: payload.phone ?? baseStudent.phone,
        plan: payload.plan ?? baseStudent.plan,
        seat_number: payload.seat_number ?? null,
        status: payload.status ?? baseStudent.status,
      },
      error: null,
    };
  }

  if (state.table === "students") {
    return { data: baseStudent, error: null };
  }

  return { data: null, error: null };
};

const makeQuery = (table: string) => {
  const state: QueryState = {
    maybeSingle: false,
    mode: "select",
    payload: null,
    table,
  };

  const query: any = {
    eq: vi.fn(() => query),
    insert: vi.fn((payload: Record<string, unknown>) => {
      state.mode = "insert";
      state.payload = payload;
      return query;
    }),
    maybeSingle: vi.fn(async () => {
      state.maybeSingle = true;
      return makeQueryResult(state);
    }),
    order: vi.fn(() => query),
    select: vi.fn(() => query),
    then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(makeQueryResult(state)).then(resolve, reject),
    update: vi.fn((payload: Record<string, unknown>) => {
      state.mode = "update";
      state.payload = payload;
      return query;
    }),
  };

  return query;
};

const createMockClient = () => {
  const auth = {
    getUser: vi.fn(async (token: string) => {
      if (!token) {
        return { data: { user: null }, error: new Error("missing token") };
      }

      return { data: { user: { id: "user-1" } }, error: null };
    }),
  };

  return {
    auth,
    from: vi.fn((table: string) => makeQuery(table)),
  };
};

const createMockResponse = (): StudentApiResponse & { body: string } => {
  return {
    body: "",
    end(body?: string) {
      this.body = body ?? "";
    },
    setHeader: vi.fn(),
    statusCode: 0,
  };
};

describe("student update route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createClientMock.mockReturnValue(createMockClient());
  });

  it("updates the student through the authenticated client when service credentials are missing", async () => {
    const request: StudentApiRequest = {
      body: {
        address: "New address",
        dueDate: "2026-06-30",
        gender: "male",
        name: "Updated Student",
        notes: "New notes",
        paymentStatus: "Paid",
        phone: "9111111111",
        planName: "Starter",
        seatNumber: "B2",
      },
      headers: {
        authorization: "Bearer valid-session-token",
        "content-type": "application/json",
      },
      method: "PATCH",
      url: "/api/students/student-1",
    };
    const response = createMockResponse();
    const env = {
      SUPABASE_ANON_KEY: "anon-key",
      SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
      SUPABASE_URL: "https://drifted.supabase.co",
      VITE_SUPABASE_ANON_KEY: "anon-key",
      VITE_SUPABASE_URL: "https://example.supabase.co",
    };

    await handleStudentApiRequest(request, response, env);

    expect(response.statusCode).toBe(200);

    const payload = JSON.parse(response.body) as {
      message: string;
      student: { name: string; phone: string | null; seatNo: string | null; status: string };
      success: boolean;
    };

    expect(payload).toMatchObject({
      message: "Student updated successfully.",
      student: {
        name: "Updated Student",
        phone: "9111111111",
        seatNo: "B2",
      },
      success: true,
    });
    expect(payload.student.status).toBe("Paid");
    expect(createClientMock).toHaveBeenCalled();
    expect(createClientMock).toHaveBeenCalledWith(
      "https://example.supabase.co",
      "anon-key",
      expect.objectContaining({
        auth: expect.objectContaining({
          autoRefreshToken: false,
          persistSession: false,
        }),
      }),
    );
    expect(createClientMock).toHaveBeenCalledWith(
      "https://example.supabase.co",
      "service-role-key",
      expect.objectContaining({
        auth: expect.objectContaining({
          autoRefreshToken: false,
          persistSession: false,
        }),
      }),
    );
  });
});
