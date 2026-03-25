import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding database...");

  // Create default user
  const hash = bcrypt.hashSync("stockpulse", 10);
  await prisma.user.upsert({
    where: { id: "default-user" },
    update: {},
    create: {
      id: "default-user",
      passwordHash: hash,
      role: "admin",
    },
  });

  // Create default settings
  const defaults = [
    { key: "default_horizon", value: "1W" },
    { key: "default_rank_mode", value: "expected_return" },
    { key: "refresh_interval", value: "60" },
  ];
  for (const s of defaults) {
    await prisma.setting.upsert({
      where: { key: s.key },
      update: { value: s.value },
      create: s,
    });
  }

  // Create default model config
  await prisma.modelConfig.upsert({
    where: { name: "default_quantile" },
    update: {},
    create: {
      name: "default_quantile",
      type: "heuristic",
      params: {
        momentumWeight: 0.3,
        meanReversionWeight: 0.2,
        trendWeight: 0.3,
        valueWeight: 0.2,
      },
      isDefault: true,
    },
  });

  console.log("Seed complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
