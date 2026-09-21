import { defineDecision } from "@jevcal/core";
import { z } from "zod";
import { bool } from "../lib/rng.mjs";

export const decision = defineDecision({
  name: "phishing-email-detection",
  fields: z.object({
    isPhishing: z.boolean().describe("Whether this email is a phishing attempt"),
    riskLevel: z.enum(["low", "medium", "high"]).describe("Risk level of this email"),
  }),
});

export function generateCase(rng, index) {
  const bucket = index % 3; // 0=clear legitimate, 1=clear phishing, 2=borderline
  let senderDomainMismatch;
  let containsSuspiciousLink;
  let requestsCredentials;
  let containsUrgencyLanguage;
  let fromKnownContact;

  if (bucket === 0) {
    senderDomainMismatch = false;
    containsSuspiciousLink = false;
    requestsCredentials = false;
    containsUrgencyLanguage = bool(rng, 0.2);
    fromKnownContact = true;
  } else if (bucket === 1) {
    requestsCredentials = bool(rng, 0.6);
    senderDomainMismatch = true;
    containsSuspiciousLink = true;
    containsUrgencyLanguage = true;
    fromKnownContact = false;
  } else {
    senderDomainMismatch = bool(rng, 0.5);
    containsSuspiciousLink = !senderDomainMismatch;
    requestsCredentials = false;
    containsUrgencyLanguage = bool(rng, 0.5);
    fromKnownContact = bool(rng, 0.5);
  }

  return { senderDomainMismatch, containsSuspiciousLink, requestsCredentials, containsUrgencyLanguage, fromKnownContact };
}

export function describeCase(c) {
  return (
    "Email analysis: sender domain does not match the claimed organization: " +
    `${c.senderDomainMismatch ? "yes" : "no"}. Contains a suspicious or shortened link: ` +
    `${c.containsSuspiciousLink ? "yes" : "no"}. Directly requests login credentials or payment info: ` +
    `${c.requestsCredentials ? "yes" : "no"}. Uses urgent, pressuring language: ` +
    `${c.containsUrgencyLanguage ? "yes" : "no"}. From a contact the recipient has emailed before: ` +
    `${c.fromKnownContact ? "yes" : "no"}.`
  );
}

export function groundTruth(c) {
  return { isPhishing: c.requestsCredentials || (c.senderDomainMismatch && c.containsSuspiciousLink) };
}
