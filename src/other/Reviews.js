import React from "react";

import { REVIEWS } from "./review_text.js";

import { AiFillStar } from "react-icons/ai";

export default function Reviews() {
  return (
    <div id="reviews-img" className="d-none">
      {/* reviews image (only shown in print mode) */}
      {REVIEWS.map((review, i) => {
        return (
          <span key={Math.random()}>
            <p className={i > 0 ? "mt-3 mb-1" : "mb-1 mt-0"}>
              {[1, 2, 3, 4, 5].map((_) => (
                <AiFillStar color="goldenrod" key={Math.random()} />
              ))}
            </p>
            <p className="text-center px-1 my-0">{review}</p>
          </span>
        );
      })}
    </div>
  );
}
