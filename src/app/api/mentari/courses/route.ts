import { NextRequest, NextResponse } from "next/server";
import {
  login,
  getCourseListRaw,
  normalizeCourses,
  getCourseDetail,
} from "@/lib/mentari";
import {
  discoverQuizzes,
  extractSections,
  extractCourseName,
} from "@/lib/course-content";
import type {
  Course,
  CourseContent,
  CourseScanRequest,
  CourseScanResponse,
} from "@/types/mentari";

// Drives a real Chrome via patchright, so this can never run on the edge runtime.
export const runtime = "nodejs";

/**
 * One scan of everything the two tabs need to fill themselves in: per course,
 * the pre-tests / post-tests it holds and the pertemuan a kuesioner can be
 * addressed to. Saves copying ids out of the Mentari URL by hand.
 *
 * POST { username, password, captcha?, kodeCourse? }
 *
 * One course detail call per enrolled course, issued serially because the
 * browser transport owns a single page. A course that fails is reported in its
 * own row rather than sinking the whole list.
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as CourseScanRequest;
    const { username, password, captcha = "test", kodeCourse, debug } = body;

    if (!username || !password) {
      return NextResponse.json(
        { courses: [], error: "username and password are required" },
        { status: 400 }
      );
    }

    const { access_token: token } = await login({ username, password, captcha });

    const sample: CourseScanResponse["sample"] = debug ? {} : undefined;

    let courses: Course[];
    if (kodeCourse) {
      courses = [{ kode_course: kodeCourse }];
    } else {
      const rawList = await getCourseListRaw(token);
      if (sample) sample.courseList = rawList;
      courses = normalizeCourses(rawList);
    }

    const results: CourseContent[] = [];

    for (const course of courses) {
      const row: CourseContent = {
        kodeCourse: course.kode_course,
        namaCourse:
          course.nama_mata_kuliah || course.coursename || course.kode_course,
        courseLabel: course.coursename,
        quizzes: [],
        sections: [],
      };

      try {
        const detail = await getCourseDetail(token, course.kode_course);
        if (sample && sample.courseDetail === undefined) sample.courseDetail = detail;
        row.quizzes = discoverQuizzes(detail);
        row.sections = extractSections(detail);

        // Scanning a single course means no list row to take the name from.
        const nameFromDetail = extractCourseName(detail);
        if (nameFromDetail) {
          row.courseLabel = row.courseLabel ?? nameFromDetail;
          if (row.namaCourse === course.kode_course) row.namaCourse = nameFromDetail;
        }
      } catch (err) {
        row.error = err instanceof Error ? err.message : "Failed to load course";
      }

      results.push(row);
    }

    // With debug on, the first course's untouched JSON rides along so an
    // unfamiliar course layout can be diagnosed without a browser devtools trip.
    const payload: CourseScanResponse = { courses: results, sample };
    return NextResponse.json(payload);
  } catch (err) {
    return NextResponse.json(
      {
        courses: [],
        error: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
