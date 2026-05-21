import dns from "node:dns";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EmailSendConfigSchema } from "./config-schemas.js";
import { interpolateTemplate } from "./template-interpolate.js";

const mocks = vi.hoisted(() => ({
  createTransport: vi.fn(),
  sendMail: vi.fn(),
  resendCtor: vi.fn(),
  resendSend: vi.fn(),
}));

vi.mock("nodemailer", () => ({
  default: {
    createTransport: mocks.createTransport,
  },
}));

vi.mock("resend", () => ({
  Resend: mocks.resendCtor,
}));

function ctx() {
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn(),
  };
  logger.child.mockReturnValue(logger);
  return {
    executionId: "exec-test",
    workflowId: "wf-test",
    workflowVersion: 1,
    variables: {},
    logger,
  };
}

describe("email.send", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mocks.createTransport.mockReset();
    mocks.sendMail.mockReset();
    mocks.resendCtor.mockReset();
    mocks.resendSend.mockReset();
    mocks.createTransport.mockReturnValue({ sendMail: mocks.sendMail });
    mocks.sendMail.mockResolvedValue({
      messageId: "smtp-1",
      accepted: ["to@example.com"],
      rejected: [],
      response: "250 OK",
    });
    mocks.resendCtor.mockImplementation(() => ({
      emails: { send: mocks.resendSend },
    }));
    mocks.resendSend.mockResolvedValue({ data: { id: "resend-1" }, error: null });
    vi.spyOn(dns.promises, "lookup").mockResolvedValue({
      address: "127.0.0.1",
      family: 4,
    });
  });

  it("defaults old workflow configs to SMTP", () => {
    const parsed = EmailSendConfigSchema.parse({
      host: "smtp.example.com",
      port: 587,
      authUser: "user",
      authPass: "pass",
      from: "from@example.com",
      to: "to@example.com",
      subject: "Hello",
      text: "Body",
    });

    expect(parsed.deliveryMode).toBe("smtp");
  });

  it("sends through the existing SMTP provider", async () => {
    const { emailSendNode } = await import("./email.send.js");
    const result = await emailSendNode.execute({
      nodeId: "email",
      nodeType: "email.send",
      workflow: { id: "wf", nodes: [], edges: [] },
      config: {
        deliveryMode: "smtp",
        host: "smtp.example.com",
        port: 587,
        secure: false,
        authUser: "user",
        authPass: "pass",
        from: "from@example.com",
        to: "to@example.com",
        subject: "Hello {{name}}",
        text: "Body for {{name}}",
      },
      inputData: { name: "Aman" },
      context: ctx(),
      attempt: 1,
    } as never);

    expect(mocks.createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ host: "smtp.example.com", port: 587 }),
    );
    expect(mocks.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: "Hello Aman",
        text: "Body for Aman",
      }),
    );
    expect(result).toMatchObject({ success: true, deliveryMode: "smtp" });
  });

  it("sends through Resend without SMTP", async () => {
    const { emailSendNode } = await import("./email.send.js");
    const result = await emailSendNode.execute({
      nodeId: "email",
      nodeType: "email.send",
      workflow: { id: "wf", nodes: [], edges: [] },
      config: {
        deliveryMode: "resend",
        resendApiKey: "re_test",
        from: "from@example.com",
        to: "to@example.com",
        subject: "Hello",
        html: "<p>Hi {{name}}</p>",
      },
      inputData: { name: "Aman" },
      context: ctx(),
      attempt: 1,
    } as never);

    expect(mocks.createTransport).not.toHaveBeenCalled();
    expect(mocks.resendCtor).toHaveBeenCalledWith("re_test");
    expect(mocks.resendSend).toHaveBeenCalledWith(
      expect.objectContaining({ html: "<p>Hi Aman</p>" }),
    );
    expect(result).toMatchObject({ success: true, deliveryMode: "resend" });
  });

  it("returns structured failure for Resend API errors", async () => {
    mocks.resendSend.mockResolvedValueOnce({
      data: null,
      error: { name: "validation_error", message: "Invalid API key" },
    });
    const { emailSendNode } = await import("./email.send.js");
    const result = await emailSendNode.execute({
      nodeId: "email",
      nodeType: "email.send",
      workflow: { id: "wf", nodes: [], edges: [] },
      config: {
        deliveryMode: "resend",
        resendApiKey: "bad",
        from: "from@example.com",
        to: "to@example.com",
        subject: "Hello",
        text: "Body",
      },
      inputData: {},
      context: ctx(),
      attempt: 1,
    } as never);

    expect(result).toMatchObject({
      success: false,
      deliveryMode: "resend",
      error: expect.stringContaining("Invalid API key"),
    });
  });

  it("interpolates moustache, nested, and bracket label placeholders", () => {
    const text = "{{product.name}} [BudgetInr] [Top Recommendation]";
    expect(
      interpolateTemplate(text, {
        product: { name: "Earphones" },
        budgetInr: 2000,
        topRecommendation: "Model A",
      }),
    ).toBe("Earphones 2000 Model A");
  });
});
