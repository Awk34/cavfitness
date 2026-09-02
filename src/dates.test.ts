import {describe, expect, test} from '@jest/globals';
import {Month, Week, weekTextToWeek} from "./dates";

const JULY_TEST_CASES = [
    "\"Train for Life” Programming: July 7 – July 12 ",
    "\"Train for Life” Programming: July 7th – July 12th ",
    "\"Train for Life” Programming: July 7th – July 12th",
    "July 7th – July 12th",
    " 07/07 - 07/12",
    "dfasdfasdf07/07 - 07/12asdfasdf",
    "J7/07 - 07/12th!!!",
    "7/7 - 7/12",
    "&nbsp;July 7th – July 12th<div>",
    // Different dashes
    "July 7th ־ July 12th",
    "July 7th ֊ July 12th",
    "July 7th ־ July 12th",
    "July 7th - July 12th",
    "July 7 — July 12",
    "July 7 - 12",
    "July 7th - 12th",
];

const AUG_SEPT_TEST_CASES = [
    "Programming: August 31- September 7th",
    "August 31st - September 7th",
    "Aug 31 - Sept 7",
    "Aug. 31 - Sept. 7th",
    "08/31 - 09/07",
    "8/31-9/7",
    "AUGUST 31- SEPTEMBER 7TH",
    `THE WEEK’S MISSION 
"TRAIN FOR LIFE” Philosophy 
Lift & Move Method 
Programming: August 31- September 7th 
MONDAY — UPPER BODY ENERGY 
FOCUS: CHEST & BICEPS`,
];

const EXPECTED_JULY_WEEK = new Week(
    Month.July, 7,
    Month.July, 12);

const EXPECTED_AUG_SEPT_WEEK = new Week(
    Month.August, 31,
    Month.September, 7);

describe('dates', () => {
    test.each(JULY_TEST_CASES)(
        'should parse July week text %s',
        (weekText) => {
            expect(weekTextToWeek(weekText)).toEqual(EXPECTED_JULY_WEEK);
        });

    test.each(AUG_SEPT_TEST_CASES)(
        'should parse Aug/Sept week text %s',
        (weekText) => {
            expect(weekTextToWeek(weekText)).toEqual(EXPECTED_AUG_SEPT_WEEK);
        });
});

