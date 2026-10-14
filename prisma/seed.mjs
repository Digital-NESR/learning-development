// Seeds the training calendar and notification templates. Safe to run more than once.
// Usage: npm run db:seed            (trainings + templates)
//        npm run db:seed -- --demo  (also the demo people used by DEMO_LOGIN)
import { PrismaClient } from "@prisma/client";
import { SEED_TRAININGS, DEFAULT_TEMPLATES, DEMO_PEOPLE } from "../lib/constants.js";

const prisma = new PrismaClient();

async function main() {
  for (const t of DEFAULT_TEMPLATES) {
    await prisma.notificationTemplate.upsert({
      where: { id: t.id },
      update: {},
      create: { id: t.id, name: t.name, trigger: t.trigger, subject: t.subject, body: t.body }
    });
  }
  console.log(`Templates: ${DEFAULT_TEMPLATES.length} ensured`);

  if ((await prisma.training.count()) === 0) {
    await prisma.training.createMany({
      data: SEED_TRAININGS.map(t => ({
        code: t.code, title: t.title, category: t.category, type: t.type,
        startDate: new Date(t.start), endDate: new Date(t.end), location: t.location,
        seats: t.seats, enrolled: t.enrolled, instructor: t.instructor, description: t.desc
      }))
    });
    console.log(`Trainings: ${SEED_TRAININGS.length} created`);
  } else {
    console.log("Trainings: table already has data, skipped");
  }

  if (process.argv.includes("--demo")) {
    for (const p of DEMO_PEOPLE) {
      const data = {
        name: p.name, firstName: p.name.split(" ")[0], nesrId: p.nesrId, title: p.title,
        department: p.department, location: p.location, isAdmin: !!p.admin
      };
      await prisma.employee.upsert({ where: { email: p.email }, update: data, create: { email: p.email, ...data } });
    }
    for (const p of DEMO_PEOPLE.filter(x => x.boss)) {
      const boss = await prisma.employee.findUnique({ where: { email: p.boss } });
      await prisma.employee.update({ where: { email: p.email }, data: { managerId: boss.id } });
    }
    console.log(`Demo people: ${DEMO_PEOPLE.length} ensured`);
  }
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
