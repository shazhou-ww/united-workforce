export type ServeOptions = {
  port: number;
  hostname: string;
  name: string;
  noTunnel: boolean;
  tunnelUrl: string | null;
  gatewayUrl: string;
  gatewaySecret: string;
};
