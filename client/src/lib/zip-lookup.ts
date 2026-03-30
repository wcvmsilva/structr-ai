// Charleston area ZIP code to city mapping
const ZIP_TO_CITY: Record<string, string> = {
  // Charleston Metro
  "29401": "Charleston",
  "29403": "Charleston",
  "29405": "North Charleston",
  "29406": "North Charleston",
  "29407": "Charleston",
  "29409": "Charleston",
  "29412": "Charleston",
  "29414": "Charleston",
  "29418": "North Charleston",
  "29422": "Charleston",
  "29464": "Mount Pleasant",
  "29466": "Mount Pleasant",
  // Barrier Islands
  "29438": "Edisto Island",
  "29439": "Folly Beach",
  "29451": "Isle of Palms",
  "29455": "Johns Island",
  "29482": "Sullivan's Island",
  // Summerville / Goose Creek / Berkeley / Dorchester
  "29445": "Goose Creek",
  "29456": "Ladson",
  "29461": "Moncks Corner",
  "29470": "Ridgeville",
  "29472": "Ridgeville",
  "29483": "Summerville",
  "29485": "Summerville",
  "29486": "Summerville",
  "29492": "Mount Pleasant",
  // Outer Lowcountry
  "29426": "Adams Run",
  "29431": "Awendaw",
  "29440": "Georgetown",
  "29474": "Ravenel",
  "29477": "Reevesville",
  "29479": "St. Stephen",
  "29481": "Smoaks",
  "29488": "Walterboro",
};

export function lookupCityByZip(zip: string): string | null {
  return ZIP_TO_CITY[zip.trim()] ?? null;
}
