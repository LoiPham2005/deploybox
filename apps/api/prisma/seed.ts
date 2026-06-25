import { PrismaClient } from '../src/generated/prisma';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const TEST_ACCOUNTS = [
  { email: 'owner@deploybox.local',  name: 'Owner Test',  role: 'OWNER'  },
  { email: 'admin@deploybox.local',  name: 'Admin Test',  role: 'ADMIN'  },
  { email: 'member@deploybox.local', name: 'Member Test', role: 'MEMBER' },
] as const;

async function main() {
  const passwordHash = await bcrypt.hash('changeme', 10);

  let team = await prisma.team.findUnique({ where: { slug: 'internal' } });
  if (!team) {
    team = await prisma.team.create({ data: { name: 'Internal', slug: 'internal' } });
  }

  for (const account of TEST_ACCOUNTS) {
    const user = await prisma.user.upsert({
      where: { email: account.email },
      update: { name: account.name, passwordHash },
      create: { email: account.email, name: account.name, passwordHash },
    });

    await prisma.teamMember.upsert({
      where: { teamId_userId: { teamId: team.id, userId: user.id } },
      update: { role: account.role },
      create: { teamId: team.id, userId: user.id, role: account.role },
    });

    console.log(`✓ ${account.role.padEnd(6)} → ${account.email} / changeme`);
  }

  // Tạo LOCAL server mặc định cho team "internal" nếu chưa có
  const existing = await prisma.server.findFirst({
    where: { teamId: team.id, type: 'LOCAL' },
  });
  if (!existing) {
    await prisma.server.create({
      data: {
        teamId: team.id,
        name: 'Local Machine',
        host: 'localhost',
        type: 'LOCAL',
        status: 'ONLINE',
      },
    });
    console.log('✓ LOCAL server "Local Machine" tạo cho team internal');
  }

  console.log('\nSeed xong! Team "internal" có 3 tài khoản test.');
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
