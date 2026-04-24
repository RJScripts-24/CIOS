/*
  Warnings:

  - The values [project_owner] on the enum `UserRole` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the column `fathom_link` on the `projects` table. All the data in the column will be lost.
  - You are about to drop the column `sort_order` on the `thread_groups` table. All the data in the column will be lost.
  - You are about to drop the column `access_level` on the `threads` table. All the data in the column will be lost.
  - Changed the type of `access_level` on the `project_members` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Made the column `workspace_id` on table `users` required. This step will fail if there are existing NULL values in that column.

*/
-- CreateEnum
CREATE TYPE "AccessLevel" AS ENUM ('read_only', 'edit');

-- CreateEnum
CREATE TYPE "InvitationStatus" AS ENUM ('pending', 'accepted');

-- AlterEnum
BEGIN;
CREATE TYPE "UserRole_new" AS ENUM ('admin', 'team_member');
ALTER TABLE "public"."users" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "users" ALTER COLUMN "role" TYPE "UserRole_new" USING ("role"::text::"UserRole_new");
ALTER TYPE "UserRole" RENAME TO "UserRole_old";
ALTER TYPE "UserRole_new" RENAME TO "UserRole";
DROP TYPE "public"."UserRole_old";
ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'team_member';
COMMIT;

-- DropForeignKey
ALTER TABLE "users" DROP CONSTRAINT "users_workspace_id_fkey";

-- AlterTable
ALTER TABLE "project_members" DROP COLUMN "access_level",
ADD COLUMN     "access_level" "AccessLevel" NOT NULL;

-- AlterTable
ALTER TABLE "projects" DROP COLUMN "fathom_link",
ADD COLUMN     "fathom_links" TEXT[];

-- AlterTable
ALTER TABLE "thread_groups" DROP COLUMN "sort_order";

-- AlterTable
ALTER TABLE "threads" DROP COLUMN "access_level";

-- AlterTable
ALTER TABLE "users" ALTER COLUMN "workspace_id" SET NOT NULL;

-- CreateTable
CREATE TABLE "workspace_invitations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "invited_by" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "status" "InvitationStatus" NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspace_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "workspace_invitations_token_key" ON "workspace_invitations"("token");

-- CreateIndex
CREATE INDEX "workspace_invitations_workspace_id_idx" ON "workspace_invitations"("workspace_id");

-- CreateIndex
CREATE INDEX "workspace_invitations_token_idx" ON "workspace_invitations"("token");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_is_revoked_idx" ON "refresh_tokens"("user_id", "is_revoked");

-- AddForeignKey
ALTER TABLE "workspace_invitations" ADD CONSTRAINT "workspace_invitations_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_invitations" ADD CONSTRAINT "workspace_invitations_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
