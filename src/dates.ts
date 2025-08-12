import {assertExists} from "./util";

const weekTextRegexp = /(\d{1,2})\/(\d{1,2}) [-–֊-־] (\d{1,2})\/(\d{1,2})/;
const weekTextRegexp2 = /([a-z]+)\s(\d{1,2})(?:th)? [-–֊-־] ([a-z]+)\s(\d{1,2})(?:th)?/i;

export function weekTextToWeek(weekText: string): Week {
    const weekTextExecResult = weekTextRegexp.exec(weekText)!;

    if (weekTextExecResult) {
        let startMonth: Month = parseInt(weekTextExecResult[1], 10) as Month;
        let startDay = parseInt(weekTextExecResult[2], 10);
        let endMonth: Month = parseInt(weekTextExecResult[3], 10) as Month;
        let endDay = parseInt(weekTextExecResult[4], 10);

        return new Week(startMonth, startDay, endMonth, endDay);
    } else {
        // 01/01 - 01/08 didn't match
        // Try May 12 - May 17 format
        const weekTextExecResult2 = weekTextRegexp2.exec(weekText);

        if (!weekTextExecResult2) {
            throw new Error(`Neither date scheme matched: "${weekText}"`);
        }

        let startMonth = monthEnumMap.get(weekTextExecResult2[1]);
        let startDay = parseInt(weekTextExecResult2[2], 10);
        let endMonth = monthEnumMap.get(weekTextExecResult2[3]);
        let endDay = parseInt(weekTextExecResult2[4], 10);

        assertExists(startMonth);
        assertExists(endMonth);

        return new Week(startMonth, startDay, endMonth, endDay);
    }
}

export class Week {
    private readonly startMonth: Month;
    private readonly startDay: number;
    private readonly endMonth: Month;
    private readonly endDay: number;

    constructor(startMonth: Month, startDay: number, endMonth: Month, endDay: number) {
        this.startMonth = startMonth;
        this.startDay = startDay;
        this.endMonth = endMonth;
        this.endDay = endDay;
    }

    static getDateText(month: Month, day: number): string {
        let monthString = `${month}`.padStart(2, '0');
        let dayString = `${day}`.padStart(2, '0');
        return `${monthString}/${dayString}`;
    }

    getStartDateString(): string {
        return Week.getDateText(this.startMonth, this.startDay);
    }

    getEndDateString(): string {
        return Week.getDateText(this.endMonth, this.endDay);
    }
}

export enum Month {
    January = 1,
    February = 2,
    March = 3,
    April = 4,
    May = 5,
    June = 6,
    July = 7,
    August = 8,
    September = 9,
    October = 10,
    November = 11,
    December = 12,
}

// Convert text month name to enum
const monthEnumMap = new Map([
    ["Jan", Month.January],
    ["Feb", Month.February],
    ["Mar", Month.March],
    ["Apr", Month.April],
    ["May", Month.May],
    ["Jun", Month.June],
    ["Jul", Month.July],
    ["Aug", Month.August],
    ["Sep", Month.September],
    ["Oct", Month.October],
    ["Nov", Month.November],
    ["Dec", Month.December],

    ["January", Month.January],
    ["February", Month.February],
    ["March", Month.March],
    ["April", Month.April],
    // ["May", Month.May],
    ["June", Month.June],
    ["July", Month.July],
    ["August", Month.August],
    ["September", Month.September],
    ["October", Month.October],
    ["November", Month.November],
    ["December", Month.December],
]);
