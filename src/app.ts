import WebSocketExtension from "@rc-ex/ws";
import Softphone from "ringcentral-softphone";
import waitFor from "wait-for-async";
import RingCentral from "@rc-ex/core";
import dotenv from "dotenv";
import ExtensionTelephonySessionsEvent from "@rc-ex/core/lib/definitions/ExtensionTelephonySessionsEvent";
import CallSessionObject from "@rc-ex/core/lib/definitions/CallSessionObject";
import DebugExtension from "@rc-ex/debug";

dotenv.config();

const rc = new RingCentral({
  clientId: process.env.RINGCENTRAL_CLIENT_ID,
  clientSecret: process.env.RINGCENTRAL_CLIENT_SECRET,
});

let conferenceCreated = false;
let conferenceReady = false;
let conferenceSessionId = "";
const processedTelephonySessionIds = new Set();
const main = async () => {
  await rc.authorize({
    jwt: process.env.RINGCENTRAL_JWT_TOKEN!,
  });

  const softphone = new Softphone({
    domain: process.env.SIP_INFO_DOMAIN!,
    outboundProxy: process.env.SIP_INFO_OUTBOUND_PROXY!,
    authorizationId: process.env.SIP_INFO_AUTHORIZATION_ID!,
    username: process.env.SIP_INFO_USERNAME!,
    password: process.env.SIP_INFO_PASSWORD!,
    codec: "OPUS/16000",
  });
  await softphone.register();

  const debugExtension = new DebugExtension();
  await rc.installExtension(debugExtension);
  softphone.enableDebugMode();

  const webSocketExtension = new WebSocketExtension();
  await rc.installExtension(webSocketExtension);
  await webSocketExtension.subscribe(
    ["/restapi/v1.0/account/~/extension/~/telephony/sessions"],
    async (event: ExtensionTelephonySessionsEvent) => {
      console.log(JSON.stringify(event, null, 2));
      const telephonySessionId = event.body!.telephonySessionId!;
      if (processedTelephonySessionIds.has(telephonySessionId)) {
        return;
      }
      const parties = event.body!.parties!;
      for (const party of parties) {
        if (
          party.direction === "Inbound" &&
          party.status?.code === "Answered" &&
          party.queueCall === true &&
          party.to?.phoneNumber === process.env.CALL_QUEUE_PHONE_NUMBER
        ) {
          if (!conferenceCreated) {
            conferenceCreated = true;
            const r = await rc.post(
              "/restapi/v1.0/account/~/telephony/conference",
              {}
            );
            const conferenceSession = (r.data as any)
              .session as CallSessionObject;

            conferenceSessionId = conferenceSession.id!;

            await softphone.call(
              conferenceSession.voiceCallToken as unknown as string
            );
          }
          await waitFor({
            interval: 1000,
            condition: () => conferenceReady,
          });
          const callParty = await rc
            .restapi()
            .account()
            .telephony()
            .sessions(conferenceSessionId)
            .parties()
            .bringIn()
            .post({
              sessionId: telephonySessionId,
              partyId: party.id,
            });
          processedTelephonySessionIds.add(telephonySessionId);
          console.log(JSON.stringify(callParty, null, 2));
        } else if (
          party.direction === "Outbound" &&
          party.status?.code === "Answered" &&
          party.to?.phoneNumber === "conference"
        ) {
          conferenceReady = true;
        }
      }
    }
  );

  await softphone.call(process.env.CALL_QUEUE_PHONE_NUMBER!);
  await waitFor({ interval: 999999999 });
  await rc.revoke();
};

main();
