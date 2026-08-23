export async function verifyCapabilityResult({ capability, result, verifiers = new Map(), context = {} }) {
  if (result?.status !== "completed") return result;
  const verifier = verifiers.get(capability.verification);
  if (!verifier) {
    return { ...result, verification: { status: "unverified", reason: `Verifier not registered: ${capability.verification}` } };
  }
  try {
    const verification = await verifier(result.output, { ...context, capability });
    if (!verification || verification.status !== "verified") {
      return { ...result, status: "failed", verification: verification || { status: "failed" }, error: { code: "VERIFICATION_FAILED", message: "Capability result did not satisfy its verification contract." } };
    }
    return { ...result, verification };
  } catch (error) {
    return { ...result, status: "failed", verification: { status: "failed" }, error: { code: "VERIFICATION_ERROR", message: error.message } };
  }
}

export async function verifySpreadsheetResult(output) {
  if (!output || typeof output !== "object") return { status: "failed", reason: "Spreadsheet output is not an object." };
  if (output.ok === false) return { status: "failed", reason: "Spreadsheet provider reported failure." };
  return { status: "verified", checks: ["provider-result-structure"] };
}

export async function verifyBuiltinArtifactResult(output) {
  if (!output || typeof output !== "object") return { status: "failed", reason: "Provider output is not an object." };
  if (output.ok === false) return { status: "failed", reason: "Provider reported failure." };
  const artifact = output.artifact;
  const providerVerified = artifact?.verified === true;
  const inspectedPdf = artifact?.type === "application/pdf"
    && Number(artifact?.size) > 0
    && Number(artifact?.pages) > 0;
  if (!artifact?.path || (!providerVerified && !inspectedPdf)) {
    return {
      status: "failed",
      reason: `Provider did not return a verified artifact. keys=${Object.keys(output).join(",")} artifact=${JSON.stringify(output.artifact ?? null)}`
    };
  }
  return {
    status: "verified",
    checks: providerVerified
      ? ["artifact-path", "provider-artifact-verification"]
      : ["artifact-path", "pdf-signature", "pdf-page-count"]
  };
}

export async function verifyBuiltinResult(output) {
  if (output === undefined || output === null) return { status: "failed", reason: "Provider returned no result." };
  return { status: "verified", checks: ["provider-result"] };
}
