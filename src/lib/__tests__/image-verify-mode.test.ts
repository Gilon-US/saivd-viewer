import {getVerifyMode} from "@/lib/image-verify-mode";

describe("getVerifyMode", () => {
  const env = process.env.NEXT_PUBLIC_VERIFY_MODE;

  afterEach(() => {
    if (env === undefined) {
      delete process.env.NEXT_PUBLIC_VERIFY_MODE;
    } else {
      process.env.NEXT_PUBLIC_VERIFY_MODE = env;
    }
  });

  it("defaults to blob", () => {
    delete process.env.NEXT_PUBLIC_VERIFY_MODE;
    expect(getVerifyMode()).toBe("blob");
  });

  it("returns shadow and img when set", () => {
    process.env.NEXT_PUBLIC_VERIFY_MODE = "shadow";
    expect(getVerifyMode()).toBe("shadow");
    process.env.NEXT_PUBLIC_VERIFY_MODE = "img";
    expect(getVerifyMode()).toBe("img");
  });

  it("falls back to blob for unknown values", () => {
    process.env.NEXT_PUBLIC_VERIFY_MODE = "invalid";
    expect(getVerifyMode()).toBe("blob");
  });
});
