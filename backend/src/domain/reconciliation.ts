export function varianceApprovalStatus(expected: number, actual: number): "NOT_REQUIRED" | "PENDING" {
  return expected === actual ? "NOT_REQUIRED" : "PENDING";
}

export function assertVarianceReason(expected: number, actual: number, reason?: string): void {
  if (expected !== actual && !reason?.trim()) {
    throw new Error("VARIANCE_REASON_REQUIRED");
  }
}
