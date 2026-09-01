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

function officePathHint(pathValue) {
  const path = String(pathValue || "").toLowerCase();
  if (path.endsWith(".pdf")) return "pdf";
  if (path.endsWith(".docx")) return "docx";
  if (path.endsWith(".pptx")) return "pptx";
  if (path.endsWith(".xlsx")) return "xlsx";
  if (path.endsWith(".html") || path.endsWith(".htm")) return "html";
  return "";
}

export async function verifyBuiltinArtifactResult(output) {
  if (!output || typeof output !== "object") return { status: "failed", reason: "Provider output is not an object." };
  if (output.ok === false) return { status: "failed", reason: "Provider reported failure." };
  const artifact = output.artifact;
  const providerVerified = artifact?.verified === true;
  const size = Number(artifact?.size) || 0;
  const type = String(artifact?.type || "").toLowerCase();
  const format = String(artifact?.format || officePathHint(artifact?.path)).toLowerCase();
  const inspectedPdf = type === "application/pdf"
    && size > 0
    && Number(artifact?.pages) > 0;
  const inspectedHtml = size > 0 && (
    format === "html"
    || type.includes("text/html")
    || Boolean(officePathHint(artifact?.path) === "html")
  );
  const inspectedOffice = size > 0 && (
    format === "docx" || format === "pptx" || format === "xlsx" || format === "pdf"
    || /wordprocessingml\.document|presentationml\.presentation|spreadsheetml\.sheet|application\/pdf|application\/octet-stream/.test(type)
  ) && Boolean(officePathHint(artifact?.path) || ["docx", "pptx", "xlsx", "pdf"].includes(format));
  if (!artifact?.path || (!providerVerified && !inspectedPdf && !inspectedOffice && !inspectedHtml)) {
    return {
      status: "failed",
      reason: `Provider did not return a verified artifact. keys=${Object.keys(output).join(",")} artifact=${JSON.stringify(output.artifact ?? null)}`
    };
  }
  return {
    status: "verified",
    checks: providerVerified
      ? ["artifact-path", "provider-artifact-verification"]
      : inspectedPdf
        ? ["artifact-path", "pdf-signature", "pdf-page-count"]
        : inspectedHtml
          ? ["artifact-path", "html-slide-deck"]
        : ["artifact-path", "office-size-and-extension"]
  };
}

export async function verifyBuiltinResult(output) {
  if (output === undefined || output === null) return { status: "failed", reason: "Provider returned no result." };
  return { status: "verified", checks: ["provider-result"] };
}
