-- DropForeignKey
ALTER TABLE "users" DROP CONSTRAINT "users_workspace_id_fkey";

-- AlterTable
ALTER TABLE "users" ALTER COLUMN "workspace_id" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE SET NULL ON UPDATE CASCADE;
