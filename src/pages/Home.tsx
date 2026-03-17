import Index from "./Index";
import PartnerPortalHome from "./PartnerPortalHome";

const isPartnerHostname = (hostname: string) =>
  hostname === "partner.libriofy.com" || hostname === "partner.localhost";

const Home = () => {
  const hostname = window.location.hostname;
  return isPartnerHostname(hostname) ? <PartnerPortalHome /> : <Index />;
};

export default Home;

