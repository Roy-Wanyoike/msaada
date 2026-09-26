-- CreateTable
CREATE TABLE "ChvUser" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "fullName" TEXT,
    "county" TEXT,
    "ward" TEXT,
    "passwordHash" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'chv',
    "authState" TEXT NOT NULL DEFAULT 'active',
    "organizationId" TEXT,
    "invitedById" TEXT,
    CONSTRAINT "ChvUser_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'county_department',
    "county" TEXT,
    "parentId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Organization_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Organization" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CommunityHealthUnit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "county" TEXT NOT NULL,
    "subCounty" TEXT,
    "ward" TEXT,
    "organizationId" TEXT,
    "supervisorId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CommunityHealthUnit_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "CommunityHealthUnit_supervisorId_fkey" FOREIGN KEY ("supervisorId") REFERENCES "ChvUser" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Invitation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "fullName" TEXT,
    "role" TEXT NOT NULL DEFAULT 'chv',
    "organizationId" TEXT,
    "invitedById" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "expiresAt" DATETIME NOT NULL,
    "acceptedAt" DATETIME,
    "chuId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Invitation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Invitation_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "ChvUser" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TriageRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "county" TEXT NOT NULL,
    "ward" TEXT,
    "classification" TEXT NOT NULL,
    "escalation" BOOLEAN NOT NULL DEFAULT false,
    "fallbackUsed" BOOLEAN NOT NULL DEFAULT false,
    "observedIndicators" TEXT NOT NULL,
    "aggregateTag" TEXT,
    "chpNextAction" TEXT,
    "chpInstruction" TEXT,
    "crisisLine" TEXT,
    "confidenceNote" TEXT,
    "aiModel" TEXT,
    "promptVersion" TEXT,
    "aiReasoning" TEXT,
    "chpNextActionSw" TEXT,
    "submittedById" TEXT NOT NULL,
    "encounterId" TEXT,
    CONSTRAINT "TriageRecord_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "ChvUser" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TriageRecord_encounterId_fkey" FOREIGN KEY ("encounterId") REFERENCES "Encounter" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "triageRecordId" TEXT,
    "actorId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "county" TEXT NOT NULL,
    "ward" TEXT,
    "classification" TEXT,
    "escalation" BOOLEAN NOT NULL DEFAULT false,
    "fallbackUsed" BOOLEAN NOT NULL DEFAULT false,
    "piiRedactions" TEXT,
    "policyVersion" TEXT,
    "aiModel" TEXT,
    "workflowClass" TEXT,
    "referralId" TEXT
);

-- CreateTable
CREATE TABLE "FollowUp" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueAt" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "resolvedAt" DATETIME,
    "resolutionNote" TEXT,
    "triageRecordId" TEXT NOT NULL,
    "chvId" TEXT NOT NULL,
    "referralId" TEXT,
    CONSTRAINT "FollowUp_triageRecordId_fkey" FOREIGN KEY ("triageRecordId") REFERENCES "TriageRecord" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FollowUp_referralId_fkey" FOREIGN KEY ("referralId") REFERENCES "Referral" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Household" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "householdCode" TEXT NOT NULL,
    "chwId" TEXT NOT NULL,
    "county" TEXT NOT NULL,
    "ward" TEXT,
    "label" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Household_chwId_fkey" FOREIGN KEY ("chwId") REFERENCES "ChvUser" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "HouseholdMember" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "memberCode" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "role" TEXT,
    "ageBand" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "HouseholdMember_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Encounter" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "encounterCode" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "chwId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "captureMethod" TEXT NOT NULL DEFAULT 'text',
    "connectivity" TEXT NOT NULL DEFAULT 'online',
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Encounter_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Encounter_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "HouseholdMember" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Encounter_chwId_fkey" FOREIGN KEY ("chwId") REFERENCES "ChvUser" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Referral" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "referralCode" TEXT NOT NULL,
    "encounterId" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "priority" TEXT NOT NULL DEFAULT 'routine',
    "destination" TEXT,
    "status" TEXT NOT NULL DEFAULT 'created',
    "createdBy" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledgedBy" TEXT,
    "acknowledgedAt" DATETIME,
    "completedAt" DATETIME,
    "followUpRequired" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "Referral_encounterId_fkey" FOREIGN KEY ("encounterId") REFERENCES "Encounter" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Referral_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "ChvUser" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PolicyVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "version" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "CommunityReport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reportCode" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "reporterName" TEXT,
    "reporterContact" TEXT,
    "reporterType" TEXT NOT NULL DEFAULT 'self',
    "assistedById" TEXT,
    "subjectType" TEXT NOT NULL DEFAULT 'unidentified_person',
    "subjectPersonId" TEXT,
    "subjectHouseholdId" TEXT,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'mental_health',
    "county" TEXT NOT NULL,
    "ward" TEXT,
    "landmark" TEXT,
    "directions" TEXT,
    "channel" TEXT NOT NULL DEFAULT 'web',
    "status" TEXT NOT NULL DEFAULT 'received',
    "aiInterpretation" TEXT,
    "aiModelVersion" TEXT,
    "aiConfidence" REAL,
    "aiUncertainty" TEXT,
    "aiProcessedAt" DATETIME,
    "policyVersion" TEXT,
    "policyDecision" TEXT,
    "policyWorkflowClass" TEXT,
    "idempotencyKey" TEXT
);

-- CreateTable
CREATE TABLE "ResponseCase" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "caseCode" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "reportId" TEXT NOT NULL,
    "assignedChvId" TEXT,
    "assignedSupervisorId" TEXT,
    "assignmentReason" TEXT,
    "assignmentRuleVersion" TEXT,
    "assignedAt" DATETIME,
    "acceptedAt" DATETIME,
    "reassignedAt" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'received',
    "encounterId" TEXT,
    "resolvedAt" DATETIME,
    "resolutionNote" TEXT,
    "outcomeCategory" TEXT,
    "outcomeSummary" TEXT,
    CONSTRAINT "ResponseCase_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "CommunityReport" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AiActivity" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "task" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "latencyMs" INTEGER NOT NULL,
    "errorKind" TEXT
);

-- CreateTable
CREATE TABLE "AuthSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "revokedAt" DATETIME,
    "userAgent" TEXT,
    CONSTRAINT "AuthSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "ChvUser" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuthEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "event" TEXT NOT NULL,
    "userId" TEXT,
    "emailAttempt" TEXT,
    "detail" TEXT,
    "userAgent" TEXT,
    CONSTRAINT "AuthEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "ChvUser" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "usedAt" DATETIME,
    CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "ChvUser" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "ChvUser_email_key" ON "ChvUser"("email");

-- CreateIndex
CREATE INDEX "Organization_parentId_idx" ON "Organization"("parentId");

-- CreateIndex
CREATE INDEX "Organization_type_idx" ON "Organization"("type");

-- CreateIndex
CREATE INDEX "CommunityHealthUnit_county_idx" ON "CommunityHealthUnit"("county");

-- CreateIndex
CREATE INDEX "CommunityHealthUnit_organizationId_idx" ON "CommunityHealthUnit"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Invitation_token_key" ON "Invitation"("token");

-- CreateIndex
CREATE INDEX "Invitation_email_idx" ON "Invitation"("email");

-- CreateIndex
CREATE INDEX "Invitation_status_idx" ON "Invitation"("status");

-- CreateIndex
CREATE INDEX "Invitation_invitedById_idx" ON "Invitation"("invitedById");

-- CreateIndex
CREATE INDEX "TriageRecord_county_createdAt_idx" ON "TriageRecord"("county", "createdAt");

-- CreateIndex
CREATE INDEX "TriageRecord_classification_idx" ON "TriageRecord"("classification");

-- CreateIndex
CREATE INDEX "TriageRecord_aggregateTag_idx" ON "TriageRecord"("aggregateTag");

-- CreateIndex
CREATE INDEX "TriageRecord_escalation_idx" ON "TriageRecord"("escalation");

-- CreateIndex
CREATE INDEX "TriageRecord_encounterId_idx" ON "TriageRecord"("encounterId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_idx" ON "AuditLog"("actorId");

-- CreateIndex
CREATE INDEX "AuditLog_county_idx" ON "AuditLog"("county");

-- CreateIndex
CREATE INDEX "AuditLog_event_idx" ON "AuditLog"("event");

-- CreateIndex
CREATE INDEX "FollowUp_chvId_status_idx" ON "FollowUp"("chvId", "status");

-- CreateIndex
CREATE INDEX "FollowUp_dueAt_idx" ON "FollowUp"("dueAt");

-- CreateIndex
CREATE INDEX "FollowUp_status_idx" ON "FollowUp"("status");

-- CreateIndex
CREATE INDEX "FollowUp_referralId_idx" ON "FollowUp"("referralId");

-- CreateIndex
CREATE UNIQUE INDEX "Household_householdCode_key" ON "Household"("householdCode");

-- CreateIndex
CREATE INDEX "Household_chwId_idx" ON "Household"("chwId");

-- CreateIndex
CREATE INDEX "Household_county_idx" ON "Household"("county");

-- CreateIndex
CREATE INDEX "Household_status_idx" ON "Household"("status");

-- CreateIndex
CREATE UNIQUE INDEX "HouseholdMember_memberCode_key" ON "HouseholdMember"("memberCode");

-- CreateIndex
CREATE INDEX "HouseholdMember_householdId_idx" ON "HouseholdMember"("householdId");

-- CreateIndex
CREATE INDEX "HouseholdMember_status_idx" ON "HouseholdMember"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Encounter_encounterCode_key" ON "Encounter"("encounterCode");

-- CreateIndex
CREATE INDEX "Encounter_chwId_idx" ON "Encounter"("chwId");

-- CreateIndex
CREATE INDEX "Encounter_householdId_idx" ON "Encounter"("householdId");

-- CreateIndex
CREATE INDEX "Encounter_memberId_idx" ON "Encounter"("memberId");

-- CreateIndex
CREATE INDEX "Encounter_status_idx" ON "Encounter"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Referral_referralCode_key" ON "Referral"("referralCode");

-- CreateIndex
CREATE INDEX "Referral_encounterId_idx" ON "Referral"("encounterId");

-- CreateIndex
CREATE INDEX "Referral_status_idx" ON "Referral"("status");

-- CreateIndex
CREATE INDEX "Referral_householdId_idx" ON "Referral"("householdId");

-- CreateIndex
CREATE UNIQUE INDEX "PolicyVersion_version_key" ON "PolicyVersion"("version");

-- CreateIndex
CREATE UNIQUE INDEX "CommunityReport_reportCode_key" ON "CommunityReport"("reportCode");

-- CreateIndex
CREATE UNIQUE INDEX "CommunityReport_idempotencyKey_key" ON "CommunityReport"("idempotencyKey");

-- CreateIndex
CREATE INDEX "CommunityReport_county_createdAt_idx" ON "CommunityReport"("county", "createdAt");

-- CreateIndex
CREATE INDEX "CommunityReport_status_idx" ON "CommunityReport"("status");

-- CreateIndex
CREATE INDEX "CommunityReport_category_idx" ON "CommunityReport"("category");

-- CreateIndex
CREATE INDEX "CommunityReport_subjectPersonId_idx" ON "CommunityReport"("subjectPersonId");

-- CreateIndex
CREATE INDEX "CommunityReport_subjectHouseholdId_idx" ON "CommunityReport"("subjectHouseholdId");

-- CreateIndex
CREATE UNIQUE INDEX "ResponseCase_caseCode_key" ON "ResponseCase"("caseCode");

-- CreateIndex
CREATE INDEX "ResponseCase_reportId_idx" ON "ResponseCase"("reportId");

-- CreateIndex
CREATE INDEX "ResponseCase_assignedChvId_status_idx" ON "ResponseCase"("assignedChvId", "status");

-- CreateIndex
CREATE INDEX "ResponseCase_status_idx" ON "ResponseCase"("status");

-- CreateIndex
CREATE INDEX "ResponseCase_encounterId_idx" ON "ResponseCase"("encounterId");

-- CreateIndex
CREATE INDEX "AiActivity_createdAt_idx" ON "AiActivity"("createdAt");

-- CreateIndex
CREATE INDEX "AiActivity_task_idx" ON "AiActivity"("task");

-- CreateIndex
CREATE UNIQUE INDEX "AuthSession_tokenHash_key" ON "AuthSession"("tokenHash");

-- CreateIndex
CREATE INDEX "AuthSession_userId_revokedAt_idx" ON "AuthSession"("userId", "revokedAt");

-- CreateIndex
CREATE INDEX "AuthSession_expiresAt_idx" ON "AuthSession"("expiresAt");

-- CreateIndex
CREATE INDEX "AuthEvent_userId_createdAt_idx" ON "AuthEvent"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AuthEvent_event_createdAt_idx" ON "AuthEvent"("event", "createdAt");

-- CreateIndex
CREATE INDEX "AuthEvent_emailAttempt_idx" ON "AuthEvent"("emailAttempt");

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");

-- CreateIndex
CREATE INDEX "PasswordResetToken_userId_idx" ON "PasswordResetToken"("userId");

