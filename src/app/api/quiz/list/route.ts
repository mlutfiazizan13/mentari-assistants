import { NextRequest, NextResponse } from "next/server";
import {
  login,
  getCourseListRaw,
  normalizeCourses,
  getCourseDetail,
} from "@/lib/mentari";
import { discoverQuizzes, extractCourseName } from "@/lib/quiz-discovery";
import type {
  Course,
  CourseQuizzes,
  QuizListRequest,
  QuizListResponse,
} from "@/types/mentari";

// Drives a real Chrome via patchright, so this can never run on the edge runtime.
export const runtime = "nodejs";

/**
 * Every pre-test / post-test / quiz the student can open, so the quiz id never
 * has to be copied out of the Mentari URL by hand.
 *
 * POST { username, password, captcha?, kodeCourse? }
 *
 * One course detail call per enrolled course, issued serially because the
 * browser transport owns a single page. A course that fails is reported in its
 * own row rather than sinking the whole list.
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as QuizListRequest;
    const { username, password, captcha = "test", kodeCourse, debug } = body;

    if (!username || !password) {
      return NextResponse.json(
        { courses: [], error: "username and password are required" },
        { status: 400 }
      );
    }

    const { access_token: token } = await login({ username, password, captcha });

    const sample: QuizListResponse["sample"] = debug ? {} : undefined;

    let courses: Course[];
    if (kodeCourse) {
      courses = [{ kode_course: kodeCourse }];
    } else {
      const rawList = await getCourseListRaw(token);
      if (sample) sample.courseList = rawList;
      courses = normalizeCourses(rawList);
    }

    const results: CourseQuizzes[] = [];

    for (const course of courses) {
      const row: CourseQuizzes = {
        kodeCourse: course.kode_course,
        namaCourse:
          course.nama_mata_kuliah || course.coursename || course.kode_course,
        courseLabel: course.coursename,
        quizzes: [],
      };

      try {
        const detail = await getCourseDetail(token, course.kode_course);
        if (sample && sample.courseDetail === undefined) sample.courseDetail = detail;
        row.quizzes = discoverQuizzes(detail);

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
    const payload: QuizListResponse = { courses: results, sample };
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
