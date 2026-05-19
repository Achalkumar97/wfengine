-- Add createdAt to Execution (backfill with finishedAt or now())
ALTER TABLE "Execution" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Add indexes for status and createdAt queries
CREATE INDEX IF NOT EXISTS "Execution_status_idx" ON "Execution"("status");
CREATE INDEX IF NOT EXISTS "Execution_createdAt_idx" ON "Execution"("createdAt");
