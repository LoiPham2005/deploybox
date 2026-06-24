import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const email = 'admin@deploybox.local';
  const passwordHash = await bcrypt.hash('changeme', 10);

  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: { email, name: 'Admin', passwordHash },
  });

  let team = await prisma.team.findUnique({ where: { slug: 'internal' } });
  if (!team) {
    team = await prisma.team.create({ data: { name: 'Internal', slug: 'internal' } });
  }

  await prisma.teamMember.upsert({
    where: { teamId_userId: { teamId: team.id, userId: user.id } },
    update: {},
    create: { teamId: team.id, userId: user.id, role: 'OWNER' },
  });

  console.log(
    'Seed xong → đăng nhập: admin@deploybox.local / changeme (team "internal")',
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
