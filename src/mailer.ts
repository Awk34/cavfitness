import * as nodemailer from "nodemailer";
import {
  FROM_EMAIL,
  IS_DRY_RUN,
  IS_PRODUCTION,
  MISSION_IMAGE_FILE,
  MY_EMAIL,
} from "./config";
import { createErrorMailOptions, ErrorKind } from "./errors";
import { readDkimKeyFile } from "./storage";

export async function getDkimPrivateKey(): Promise<string | undefined> {
  let dkimPrivateKey = process.env.DKIM_PRIVATE_KEY;
  if (!dkimPrivateKey) {
    try {
      dkimPrivateKey = await readDkimKeyFile();
    } catch {
      console.error("Couldn't read from DKIM key file");
    }
  }
  return dkimPrivateKey;
}

export async function setupMailTransporter(
  dkimPrivateKey?: string,
): Promise<nodemailer.Transporter> {
  const privateKey = dkimPrivateKey ?? (await getDkimPrivateKey());
  const domainName = FROM_EMAIL.split("@")[1];

  return nodemailer.createTransport({
    host: "mail.privateemail.com",
    port: 465,
    secure: true,
    auth: {
      user: FROM_EMAIL,
      pass: process.env.EMAIL_PASSWORD,
    },
    dkim: privateKey
      ? {
          domainName,
          keySelector: "default",
          privateKey,
        }
      : undefined,
    logger: true,
    debug: !IS_PRODUCTION,
  });
}

export function createMissionMailOptions(
  weeklyMissionText: string,
  missionMondayFullDate: string,
  imagePath: string = MISSION_IMAGE_FILE,
): nodemailer.SendMailOptions {
  const mailOptions: nodemailer.SendMailOptions = {
    from: FROM_EMAIL,
    subject: `The Cav Middletown weekly mission ${missionMondayFullDate}`,
    html: `<img src="cid:mission" alt="weekly mission"/><br><br>${weeklyMissionText.replaceAll(/\n/g, "<br>")}`,
    attachments: [
      {
        path: imagePath,
        cid: "mission",
      },
    ],
  };

  if (process.env.EMAIL_ADDRESSES) {
    mailOptions.bcc = process.env.EMAIL_ADDRESSES;
  } else {
    mailOptions.to = MY_EMAIL;
  }

  return mailOptions;
}

export async function sendMissionEmail(
  transporter: nodemailer.Transporter,
  mailOptions: nodemailer.SendMailOptions,
): Promise<void> {
  try {
    const response = await transporter.sendMail(mailOptions);
    console.log(response);
    console.log("Email sending success");
  } catch (error) {
    console.error("Email sending failed:", error);
    throw error;
  }
}

export async function sendErrorEmail(
  error: unknown,
  consecutiveFailures: number = 1,
  errorKind: ErrorKind = "critical",
  mailTransporter?: nodemailer.Transporter,
): Promise<void> {
  if (!IS_PRODUCTION) {
    console.log("Not production, will not send error email");
    return;
  }
  if (IS_DRY_RUN) {
    console.log("Dry run, will not send error email");
    return;
  }

  try {
    const transporter = mailTransporter ?? (await setupMailTransporter());
    const errorMailOptions = createErrorMailOptions(
      error,
      consecutiveFailures,
      errorKind,
      { from: FROM_EMAIL, to: MY_EMAIL },
    );
    await transporter.sendMail(errorMailOptions);
    console.log("Error notification email sent successfully");
  } catch (mailError) {
    console.error("Failed to send error notification email:", mailError);
  }
}
