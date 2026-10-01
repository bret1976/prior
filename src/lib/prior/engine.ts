export type Policy = {
  id: string;
  name: string;
  maxSingleUsd: number;
  maxDailyUsd: number;
  approvalAboveUsd: number;
  blockedCategories: string[];
  allowedVendors: string[];
};

export type Verdict = "allow" | "deny";

export function judge(input: {
  policy: Policy;
  amountUsd: number;
  vendor: string;
  category: string;
  spentTodayUsd: number;
}): { verdict: Verdict; reasons: string[] } {
  const reasons: string[] = [];
  const vendor = input.vendor.trim().toLowerCase();
  const category = input.category.trim().toLowerCase();
  const blocked = input.policy.blockedCategories.map((c) => c.toLowerCase());
  const allowed = input.policy.allowedVendors.map((v) => v.toLowerCase()).filter(Boolean);

  if (input.amountUsd <= 0) reasons.push("Amount must be greater than zero.");
  if (input.amountUsd > input.policy.maxSingleUsd) {
    reasons.push(`$${input.amountUsd} is over the $${input.policy.maxSingleUsd} single-charge cap.`);
  }
  if (input.spentTodayUsd + input.amountUsd > input.policy.maxDailyUsd) {
    reasons.push(
      `Today is already $${input.spentTodayUsd}. This would make $${input.spentTodayUsd + input.amountUsd}, over the $${input.policy.maxDailyUsd} daily cap.`,
    );
  }
  if (blocked.includes(category)) reasons.push(`Category "${input.category}" is blocked.`);
  if (allowed.length > 0 && !allowed.includes(vendor)) reasons.push(`Vendor "${input.vendor}" is not on the allow list.`);
  if (!vendor) reasons.push("Vendor is required.");
  if (!category) reasons.push("Category is required.");
  if (input.amountUsd > input.policy.approvalAboveUsd) {
    reasons.push(`$${input.amountUsd} is above $${input.policy.approvalAboveUsd}, so it is denied. No one is waiting to approve it.`);
  }

  if (reasons.length > 0) return { verdict: "deny", reasons };
  return { verdict: "allow", reasons: ["Inside the single cap, the daily cap, and the vendor rules."] };
}
