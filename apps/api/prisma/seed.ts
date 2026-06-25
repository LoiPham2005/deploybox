import { PrismaClient } from '../src/generated/prisma';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash('changeme', 10);

  // ─── 1. OWNER TEST ─────────────────────────────────────────────────────────
  // Có personal team riêng, không phải admin hệ thống
  const owner = await prisma.user.upsert({
    where: { email: 'owner@deploybox.local' },
    update: { name: 'Owner Test', passwordHash, isAdmin: false },
    create: { email: 'owner@deploybox.local', name: 'Owner Test', passwordHash, isAdmin: false },
  });

  const ownerTeam = await prisma.team.upsert({
    where: { slug: 'owner-test-team' },
    update: { name: "Owner Test's Team", isPersonal: true },
    create: { name: "Owner Test's Team", slug: 'owner-test-team', isPersonal: true },
  });

  await prisma.teamMember.upsert({
    where: { teamId_userId: { teamId: ownerTeam.id, userId: owner.id } },
    update: { role: 'OWNER' },
    create: { teamId: ownerTeam.id, userId: owner.id, role: 'OWNER' },
  });

  // LOCAL server cho team của owner
  const existingServer = await prisma.server.findFirst({
    where: { teamId: ownerTeam.id, type: 'LOCAL' },
  });
  if (!existingServer) {
    await prisma.server.create({
      data: { teamId: ownerTeam.id, name: 'Local Machine', host: 'localhost', type: 'LOCAL', status: 'ONLINE' },
    });
  }

  console.log(`✓ OWNER  → owner@deploybox.local / changeme  (team: "${ownerTeam.name}")`);

  // ─── 2. MEMBER TEST ────────────────────────────────────────────────────────
  // Có personal team riêng + được mời vào team của Owner
  const member = await prisma.user.upsert({
    where: { email: 'member@deploybox.local' },
    update: { name: 'Member Test', passwordHash, isAdmin: false },
    create: { email: 'member@deploybox.local', name: 'Member Test', passwordHash, isAdmin: false },
  });

  // Personal team của member
  const memberTeam = await prisma.team.upsert({
    where: { slug: 'member-test-team' },
    update: { name: "Member Test's Team", isPersonal: true },
    create: { name: "Member Test's Team", slug: 'member-test-team', isPersonal: true },
  });

  await prisma.teamMember.upsert({
    where: { teamId_userId: { teamId: memberTeam.id, userId: member.id } },
    update: { role: 'OWNER' },
    create: { teamId: memberTeam.id, userId: member.id, role: 'OWNER' },
  });

  // Member được mời vào team của Owner
  await prisma.teamMember.upsert({
    where: { teamId_userId: { teamId: ownerTeam.id, userId: member.id } },
    update: { role: 'MEMBER' },
    create: { teamId: ownerTeam.id, userId: member.id, role: 'MEMBER' },
  });

  console.log(`✓ MEMBER → member@deploybox.local / changeme  (personal + invited to "${ownerTeam.name}")`);

  // ─── 3. ADMIN TEST ─────────────────────────────────────────────────────────
  // Platform admin, có personal team riêng
  const admin = await prisma.user.upsert({
    where: { email: 'admin@deploybox.local' },
    update: { name: 'Admin Test', passwordHash, isAdmin: true },
    create: { email: 'admin@deploybox.local', name: 'Admin Test', passwordHash, isAdmin: true },
  });

  const adminTeam = await prisma.team.upsert({
    where: { slug: 'admin-test-team' },
    update: { name: "Admin Test's Team", isPersonal: true },
    create: { name: "Admin Test's Team", slug: 'admin-test-team', isPersonal: true },
  });

  await prisma.teamMember.upsert({
    where: { teamId_userId: { teamId: adminTeam.id, userId: admin.id } },
    update: { role: 'OWNER' },
    create: { teamId: adminTeam.id, userId: admin.id, role: 'OWNER' },
  });

  console.log(`✓ ADMIN  → admin@deploybox.local / changeme  [isAdmin=true, Admin Panel]`);

  console.log('\n─── Cấu trúc test ──────────────────────────────────────────');
  console.log(`  owner@deploybox.local   → OWNER của "${ownerTeam.name}"`);
  console.log(`  member@deploybox.local  → OWNER của personal team`);
  console.log(`                           + MEMBER của "${ownerTeam.name}"`);
  console.log(`                           → có Team Switcher để chuyển`);
  console.log(`  admin@deploybox.local   → isAdmin, thấy /admin panel`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
