export type ProblemTarget = "accessibility" | "vpn";

export function sameProblems(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((code, i) => code === b[i]);
}

export function describeProblem(code: string): {
  message: string;
  target: ProblemTarget;
} {
  if (code === "accessibility_off") {
    return {
      message: "Content protection is off: accessibility service is disabled",
      target: "accessibility",
    };
  }
  if (code.startsWith("vpn_taken:")) {
    const pkg = code.slice("vpn_taken:".length);
    return {
      message: `DNS protection is off: ${pkg ? `${pkg} is set as the always-on VPN` : "another VPN app holds the VPN slot"}`,
      target: "vpn",
    };
  }
  return {
    message: "DNS protection is off: the LibreAscent VPN is not running",
    target: "vpn",
  };
}
