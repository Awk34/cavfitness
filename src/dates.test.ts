import {describe, expect, test} from '@jest/globals';
import {Month, Week, weekTextToWeek} from "./dates";

const TEST_CASES = [
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
];

const EXPECTED_WEEK = new Week(
    Month.July, 7,
    Month.July, 12);

describe('dates', () => {
    test.each(TEST_CASES)(
        'should parse week text %s',
        (weekText) => {
            expect(weekTextToWeek(weekText)).toEqual(EXPECTED_WEEK);
        });
});
