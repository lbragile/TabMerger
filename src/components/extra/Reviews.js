import React from "react";

import { AiFillStar } from "react-icons/ai";

export default function Reviews() {
  const REVIEWS = [
    "Found TabMerger really helpful in organizing tabs according to specific customizable categories, with cool colors, saving my time and memory.",
    "Aesthetically it looks nice and has a comfortable feel. there are clever implementations from within the TabMerger page itself, like changing the color and using the buttons to merge and add tabs.",
    "TabMerger is a fantastic solution to a problem every internet user faces - overcrowded tabs in your browser. The extension solves this brilliantly by allowing the user to group their tabs together and color code them.",
    "Nice idea and useful tool. Keeps all your URLs on one page, stores them and allows to open from any device rather than searching in your history (if exists). Also reduces start up time and memory usage.",
    "I am so happy that I installed and used TabMerger. My laptop crashed and I had many important tabs saved in TabMerger. I was very relieved to see that all my tabs were stored in TabMerger when I reopened it. Big thanks to the developer.",
  ];

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
