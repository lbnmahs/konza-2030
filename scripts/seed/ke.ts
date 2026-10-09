// Kenya seed (Pwani Njema, Usajili Njema, Tiba Njema). Fictional; dates relative to today in
// Nairobi, working days from the Kenya calendar.
// Real phone numbers come only from .env.

import {
  addDays,
  addMonths,
  type ISODate,
} from "../../supabase/functions/_shared/rules/common/dates.ts";
import { keCalendar } from "../../supabase/functions/_shared/rules/ke/calendar.ts";
import type { Seed } from "./common.ts";

export function seedKE(today: ISODate, env: (k: string) => string): Seed {
  const bioDay = keCalendar.addWorkingDays(today, 2);
  const bioDay2 = keCalendar.addWorkingDays(today, 3);
  return {
    // Wave 3 partners (fictional). Each receives only its allowed fields.
    partners: [
      {
        id: "njema_freight",
        name: "Njema Freight Ltd (payroll)",
        sector: "employer",
        country: "KE",
        authority: "wezesha_njema",
        offer: "Payroll applies the tax exemption from the start date on the certificate",
        allowed_fields: ["certificate_number", "start_date"],
        send_when: "on_approval",
      },
      {
        id: "tembea_njema",
        name: "Tembea Njema Mobility Trust",
        sector: "charity",
        country: "KE",
        authority: "wezesha_njema",
        offer: "Mobility aids and a home visit to arrange them",
        allowed_fields: ["full_name", "phone", "area"],
        send_when: "now",
      },
    ],
    citizens: [
      {
        id: "cit_s3",
        full_name: "Mwanaisha Juma",
        dob: "1988-11-05",
        id_number: "29384756",
        phone: env("DEMO_UK_MOBILE"),
        preferred_language: "sw",
        authority: "pwani_njema",
      },
      {
        id: "cit_ke_id",
        full_name: "Kevin Mutua Kioko",
        dob: "1995-02-21",
        id_number: "31234987",
        phone: env("DEMO_UK_MOBILE"),
        preferred_language: "sw",
        authority: "usajili_njema",
      },
      {
        id: "cit_ke_health",
        full_name: "Grace Akinyi Ouma",
        dob: "1993-12-09",
        id_number: "28761093",
        phone: env("DEMO_UK_MOBILE"),
        preferred_language: "sw",
        authority: "tiba_njema",
      },
      {
        id: "cit_n2",
        full_name: "Daniel Kiprono Rotich",
        dob: "1987-04-15",
        id_number: "27450931",
        phone: env("DEMO_UK_MOBILE"),
        preferred_language: "sw",
        authority: "wezesha_njema",
      },
    ],
    // U3-KE
    id_cards: [{
      id: "card_ke_001",
      card_no: "KE-UN-0042219",
      citizen_id: "cit_ke_id",
      authority: "usajili_njema",
      status: "active",
      address_on_file: null,
    }],
    // N2: registered with the council, uses a wheelchair, taxed through payroll, no exemption.
    disability_registrations: [{
      id: "dr_001",
      reg_no: "WNC-REG-20931",
      citizen_id: "cit_n2",
      registered_on: "2025-06-10",
      area: "Bandari",
      step_free_needed: true,
      employer: "Njema Freight Ltd",
      tax_exemption: "none",
    }],
    // P15: Kevin's passport expires in 5 months, so renewal is open (PP-02).
    passports: [{
      id: "pp_ke_001",
      citizen_id: "cit_ke_id",
      number: "AK0418273",
      pages: 34,
      expires: addMonths(today, 5),
      status: "active",
    }],
    registry_offices: [
      // P15 passport biometrics desks (fictional): Nairobi, and consular desks for the diaspora.
      {
        id: "nps_nairobi",
        name: "NJIA Desk Nairobi",
        address: "Ground floor, Njema House, Nairobi",
        covers_postcodes: [],
        area: "Nairobi",
        authority: "njema_passports",
        service: "passport_biometrics",
        step_free: true,
      },
      {
        id: "nps_london",
        name: "NJIA Consular Desk London",
        address: "Level 3, 12 Larchmere Street, London",
        covers_postcodes: [],
        area: "London",
        authority: "njema_passports",
        service: "passport_biometrics",
        step_free: true,
      },
      {
        id: "nps_berlin",
        name: "NJIA Consular Desk Berlin",
        address: "Lindenhain Strasse 8, Berlin",
        covers_postcodes: [],
        area: "Berlin",
        authority: "njema_passports",
        service: "passport_biometrics",
        step_free: true,
      },
      {
        id: "wz_mjini",
        name: "Wezesha Njema Mjini Office",
        address: "Barabara ya Soko, Mjini (first floor, no lift)",
        covers_postcodes: [],
        area: "Mjini",
        authority: "wezesha_njema",
        service: "disability_vetting",
        step_free: false,
      },
      {
        id: "wz_bandari",
        name: "Wezesha Njema Bandari Office",
        address: "Barabara ya Bandari, ground floor",
        covers_postcodes: [],
        area: "Bandari",
        authority: "wezesha_njema",
        service: "disability_vetting",
        step_free: true,
      },
      {
        id: "un_mjini",
        name: "Usajili Njema Mjini Office",
        address: "Barabara ya Soko, Mjini",
        area: "Mjini",
        covers_postcodes: [],
        authority: "usajili_njema",
        service: "id_biometrics",
        step_free: true,
      },
      {
        id: "un_kaskazini",
        name: "Usajili Njema Kaskazini Office",
        address: "Barabara ya Kaskazini, Kaskazini",
        area: "Kaskazini",
        covers_postcodes: [],
        authority: "usajili_njema",
        service: "id_biometrics",
        step_free: true,
      },
    ],
    registry_slots: [
      {
        id: "wz_slot_1",
        office_id: "wz_mjini",
        starts_at: `${keCalendar.addWorkingDays(today, 2)}T09:00`,
      },
      {
        id: "wz_slot_2",
        office_id: "wz_bandari",
        starts_at: `${keCalendar.addWorkingDays(today, 3)}T10:30`,
      },
      { id: "un_slot_1", office_id: "un_mjini", starts_at: `${bioDay}T09:00` },
      { id: "un_slot_2", office_id: "un_mjini", starts_at: `${bioDay}T11:30` },
      { id: "un_slot_3", office_id: "un_kaskazini", starts_at: `${bioDay2}T10:00` },
      // Passport desks; London and Berlin times are local to the desk.
      { id: "pp_nbo_1", office_id: "nps_nairobi", starts_at: `${bioDay}T10:00` },
      { id: "pp_nbo_2", office_id: "nps_nairobi", starts_at: `${bioDay2}T14:30` },
      { id: "pp_lon_1", office_id: "nps_london", starts_at: `${bioDay2}T11:00` },
      { id: "pp_ber_1", office_id: "nps_berlin", starts_at: `${bioDay2}T09:30` },
    ],
    // K1: informal member, last contribution two months ago, so no cover this month.
    // Kevin (lost ID) is also a member, so the country agent can switch services for one person.
    health_members: [{
      id: "hm_001",
      member_no: "TN-4410288",
      citizen_id: "cit_ke_health",
      scheme: "informal",
    }, {
      id: "hm_002",
      member_no: "TN-4410931",
      citizen_id: "cit_ke_id",
      scheme: "informal",
    }],
    health_contributions: [{
      member_id: "hm_001",
      month: addMonths(today, -2).slice(0, 7),
      amount: 300,
      paid_on: addMonths(today, -2),
    }],
    county_markets: [{ id: "mkt_01", name: "Soko Kuu", ward: "Mjini" }],
    county_permits: [
      {
        id: "per_001",
        permit_no: "PWN-SBP-10492",
        citizen_id: "cit_s3",
        category: "small_trader_market_stall",
        market_id: "mkt_01",
        stall: "B-17",
        business_name: "Mama Aisha Mboga",
        expires: addDays(today, 10),
        status: "active",
        arrears_kes: 0,
      },
    ],
  };
}
